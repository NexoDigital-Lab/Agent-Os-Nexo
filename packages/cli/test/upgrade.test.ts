// The CLI from npm: how it was installed, the upgrade command per package manager, the once-a-day check for a newer
// version (cached, offline-safe), and `nexo self-update` without a checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { cachedLatest, cacheFile, installKind, latestVersion, newer, updateNotice, upgradeArgs, type Fetcher } from "../src/core/upgrade.ts";
import { selfUpdateCommand } from "../src/commands/selfupdate.ts";
import { readJson } from "../src/core/fsx.ts";

/** A file laid out like a package manager's global install of the CLI. */
function installed(...parts: string[]): string {
  const dir = join(tempDir(), ...parts, "node_modules", "@nexodigital", "nexo", "dist");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bin.js"), "");
  return join(dir, "bin.js");
}

test("installKind reads the package manager from where the CLI really lives", () => {
  assert.deepEqual(installKind(installed("usr", "lib")), { kind: "global", manager: "npm" });
  assert.deepEqual(installKind(installed("pnpm", "global", "5")), { kind: "global", manager: "pnpm" });
  assert.deepEqual(installKind(installed(".bun", "install", "global")), { kind: "global", manager: "bun" });
  assert.deepEqual(installKind(installed(".config", "yarn", "global")), { kind: "global", manager: "yarn" });
  assert.deepEqual(installKind(installed(".npm", "_npx", "abc123")), { kind: "npx" });
  assert.deepEqual(installKind(installed("tmp", "bunx-1000-@nexodigital", "nexo@latest")), { kind: "npx" }, "bunx");
  assert.deepEqual(installKind(installed(".cache", "pnpm", "dlx", "abc", "1")), { kind: "npx" }, "pnpm 9 dlx is not a global pnpm");
  assert.deepEqual(installKind(installed("AppData", "Local", "Yarn", "Data", "global")), { kind: "global", manager: "yarn" }, "yarn on Windows");
  assert.deepEqual(installKind(installed("AppData", "Roaming", "npm")), { kind: "global", manager: "npm" }, "npm on Windows");
  assert.deepEqual(installKind(installed("work", "my-app")), { kind: "local" }, "a project's dependency");
  assert.deepEqual(installKind(installed("work", "my-app", "node_modules", ".pnpm", "@nexodigital+nexo@0.1.1")), { kind: "local" }, "a project's pnpm dependency");
  assert.deepEqual(installKind(join(tempDir(), "packages", "cli", "src", "bin.ts")), { kind: "other" }, "a checkout");
  assert.deepEqual(installKind(undefined), { kind: "other" });
  // npm's global bin is a symlink to the package: followed.
  const target = installed("prefix", "lib");
  const link = join(tempDir(), "nexo");
  try {
    symlinkSync(target, link);
    assert.deepEqual(installKind(link), { kind: "global", manager: "npm" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e; // Windows without symlink rights
  }
});

test("upgradeArgs per manager", () => {
  assert.deepEqual(upgradeArgs("npm"), ["install", "--global", "@nexodigital/nexo@latest"]);
  assert.deepEqual(upgradeArgs("pnpm"), ["add", "--global", "@nexodigital/nexo@latest"]);
  assert.deepEqual(upgradeArgs("bun"), ["add", "--global", "@nexodigital/nexo@latest"]);
  assert.deepEqual(upgradeArgs("yarn"), ["global", "add", "@nexodigital/nexo@latest"]);
});

test("newer compares x.y.z, and a prerelease is older than its release", () => {
  assert.equal(newer("0.1.1", "0.1.0"), true);
  assert.equal(newer("0.2.0", "0.1.9"), true);
  assert.equal(newer("1.0.0", "0.99.99"), true);
  assert.equal(newer("0.1.0", "0.1.0"), false);
  assert.equal(newer("0.1.0", "0.1.1"), false);
  assert.equal(newer("0.1.0", "0.1.0-beta.1"), true);
  assert.equal(newer("0.1.0-beta.2", "0.1.0"), false);
  assert.equal(newer("v0.2.0", "0.1.0"), true);
});

test("latestVersion asks the registry at most once a day, and an offline machine is not retried each command", async () => {
  const state = tempDir();
  let calls = 0;
  const answer = (body: unknown, ok = true): Fetcher => async (url) => {
    calls++;
    assert.equal(url, "https://registry.npmjs.org/@nexodigital%2fnexo/latest");
    return { ok, json: async () => body };
  };
  const t0 = Date.parse("2026-10-16T10:00:00Z");
  assert.equal(await latestVersion(state, { now: t0, fetcher: answer({ version: "0.2.0" }) }), "0.2.0");
  assert.equal(await latestVersion(state, { now: t0 + 60_000, fetcher: answer({ version: "9.9.9" }) }), "0.2.0", "cached");
  assert.equal(calls, 1);
  assert.equal(cachedLatest(state), "0.2.0");
  const down: Fetcher = async () => {
    calls++;
    throw new Error("offline");
  };
  const tomorrow = t0 + 25 * 3600_000;
  assert.equal(await latestVersion(state, { now: tomorrow, fetcher: down }), "0.2.0", "offline: keeps what it knew");
  assert.equal(await latestVersion(state, { now: tomorrow + 1000, fetcher: down }), "0.2.0");
  assert.equal(calls, 2, "the failed check counts as today's");
  assert.equal(await latestVersion(state, { now: tomorrow, fetcher: answer({ version: "not a version" }), force: true }), "0.2.0", "a strange answer keeps what was known");
  assert.equal(await latestVersion(state, { now: tomorrow, fetcher: answer({}, false), force: true }), "0.2.0", "so does a 503");
  writeFileSync(cacheFile(state), "{ broken");
  assert.equal(cachedLatest(state), null, "a broken cache reads as nothing");
  assert.equal(await latestVersion(state, { now: tomorrow, fetcher: answer({ version: "0.3.0" }) }), "0.3.0", "and is rewritten");
  assert.equal(readJson<{ latest: string }>(cacheFile(state)).latest, "0.3.0");
});

test("updateNotice says how to upgrade for the way the CLI was installed", () => {
  assert.equal(updateNotice("0.1.0", "0.2.0", { kind: "global", manager: "pnpm" }), "nexo 0.2.0 is available (this is 0.1.0): `nexo self-update` (pnpm add --global @nexodigital/nexo@latest)");
  assert.match(updateNotice("0.1.0", "0.2.0", { kind: "npx" }), /`npx @nexodigital\/nexo@latest`$/);
  assert.match(updateNotice("0.1.0", "0.2.0", { kind: "other" }), /`nexo self-update`$/);
  assert.match(updateNotice("0.1.0", "0.2.0", { kind: "local" }), /update @nexodigital\/nexo in this project's package\.json$/);
});

test("self-update without a checkout upgrades with the package manager that installed the CLI", async () => {
  const root = await freshEnv();
  const ran: string[][] = [];
  const out = selfUpdateCommand({ root }, { install: { kind: "global", manager: "npm" }, run: (cmd, args) => (ran.push([cmd, ...args]), 0) });
  assert.deepEqual(ran, [["npm", "install", "--global", "@nexodigital/nexo@latest"]]);
  assert.match(out, /Upgraded with npm install --global @nexodigital\/nexo@latest/);
  assert.throws(() => selfUpdateCommand({ root }, { install: { kind: "global", manager: "bun" }, run: () => 1 }), /bun add --global @nexodigital\/nexo@latest failed \(exit 1\)/);
  assert.match(selfUpdateCommand({ root }, { install: { kind: "npx" }, run: () => assert.fail("never runs") }), /runs through npx/);
  assert.throws(() => selfUpdateCommand({ root }, { install: { kind: "other" } }), /Usage: nexo self-update/);
  assert.match(selfUpdateCommand({ root }, { install: { kind: "local" }, run: () => assert.fail("never runs") }), /dependency of a project/);
});

test("a global install upgrades from npm even when a checkout was used before; --from still means the checkout", async () => {
  const root = await freshEnv();
  writeFileSync(join(root, ".state", "nexo", "cli.json"), JSON.stringify({ source: "/old/checkout", ref: "main", commit: "abc", version: "0.1.0", dir: "/d", launcher: "/l", installedAt: "now" }));
  const ran: string[][] = [];
  selfUpdateCommand({ root }, { install: { kind: "global", manager: "npm" }, run: (cmd, args) => (ran.push([cmd, ...args]), 0) });
  assert.deepEqual(ran, [["npm", "install", "--global", "@nexodigital/nexo@latest"]]);
  assert.throws(() => selfUpdateCommand({ root, from: join(root, "nope") }, { install: { kind: "global", manager: "npm" }, run: () => assert.fail("not npm") }));
});

test("self-update rewrites the memory connection, which names the nexo the AIs start", async () => {
  const root = await freshEnv();
  const config = join(root, "environment.config.json");
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), memory: "engram" }));
  const connection = join(root, "library", "connections", "memory.json");
  mkdirSync(join(root, "library", "connections"), { recursive: true });
  writeFileSync(connection, JSON.stringify({ name: "memory", command: "/gone/nexo", args: [] }));
  const out = selfUpdateCommand({ root }, { install: { kind: "global", manager: "npm" }, run: () => 0 });
  assert.match(out, /Memory connection refreshed/);
  const saved = readJson<{ command: string; args: string[]; env: { NEXO_ROOT: string } }>(connection);
  assert.notEqual(saved.command, "/gone/nexo");
  assert.equal(saved.env.NEXO_ROOT, root);
});
