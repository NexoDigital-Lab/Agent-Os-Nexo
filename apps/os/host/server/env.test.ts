// Where agent-os finds its environment, and the small helpers every module's server shares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { tempDir } from "../test/harness.ts";
import { CONFIG_FILE, envAt, findEnvRoot, loadEnv } from "./env.ts";
import { findBin, h, httpError, loginShell, loginWhich, trash, userBinPath } from "./http.ts";

test("env: the folders come from environment.config.json, with the defaults for the rest", () => {
  const root = tempDir();
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ folders: { projects: "work", state: ".cache" } }));
  const env = envAt(root);
  assert.equal(env.projects, join(root, "work"));
  assert.equal(env.library, join(root, "library"));
  assert.equal(env.data, join(root, "os", "data"));
  assert.equal(env.state, join(root, ".cache", "os"));
});

test("env: found from inside it, from NEXO_ROOT, or not at all", () => {
  const root = tempDir();
  writeFileSync(join(root, CONFIG_FILE), "{}");
  const build = join(root, "os", "versions", "1.0.0");
  mkdirSync(build, { recursive: true });
  assert.equal(findEnvRoot(build), root);
  assert.equal(loadEnv(build, "").root, root, "a build finds the environment it lives in");
  assert.equal(loadEnv(tempDir(), root).root, root, "NEXO_ROOT wins");
  assert.throws(() => loadEnv(tempDir(), join(root, "nope")), /No Nexo environment found at /);
  const outside = tempDir();
  if (findEnvRoot(outside) === null) assert.throws(() => loadEnv(outside, ""), /No Nexo environment found above /);
});

test("http: httpError carries its status and extra fields; h() sends results and forwards errors", async () => {
  const err = httpError(409, "taken", { id: "x" });
  assert.deepEqual([err.message, err.status, (err as unknown as { id: string }).id], ["taken", 409, "x"]);
  const sent: unknown[] = [];
  const res = { headersSent: false, json: (v: unknown) => sent.push(v) };
  const errors: unknown[] = [];
  await h(() => ({ ok: 1 }))({} as never, res as never, (e: unknown) => errors.push(e));
  await h(() => undefined)({} as never, res as never, (e: unknown) => errors.push(e));
  await h(() => {
    throw err;
  })({} as never, res as never, (e: unknown) => errors.push(e));
  assert.deepEqual(sent, [{ ok: 1 }]);
  assert.deepEqual(errors, [err]);
});

test("http: binaries are looked up in the user's bin dirs and the extra ones", () => {
  const dirs = userBinPath();
  assert.ok(dirs.includes(join(homedir(), ".local", "bin")));
  assert.equal(new Set(dirs).size, dirs.length, "no duplicates");
  const extra = tempDir();
  writeFileSync(join(extra, "nexo-fake-tool"), "");
  assert.equal(findBin("nexo-fake-tool", [extra]), join(extra, "nexo-fake-tool"));
  assert.equal(findBin("nexo-no-such-tool"), null);
  assert.ok((process.env.PATH ?? "").split(delimiter).every((d) => !d || dirs.includes(d)));
});

const unix = process.platform === "win32" ? "runs bash -lc" : false;

test("http: loginShell runs in the login shell; a failure is null", { skip: unix }, async () => {
  assert.equal(await loginShell("echo hi"), "hi");
  assert.equal(await loginShell("exit 3"), null);
  assert.match((await loginWhich("node")) ?? "", /node/);
  assert.equal(await loginWhich("nexo-no-such-tool"), null);
});

test("http: trash never deletes when the desktop trash is unavailable", async () => {
  const dir = tempDir();
  const file = join(dir, "keep.txt");
  writeFileSync(file, "x");
  const saved = process.env.PATH;
  try {
    process.env.PATH = dir; // no gio on this PATH
    await assert.rejects(trash(file, "keep.txt"), (e: Error & { status?: number }) => e.status === 500 && /Could not move keep\.txt to the trash .*Nothing was deleted\./.test(e.message));
  } finally {
    process.env.PATH = saved;
  }
});
