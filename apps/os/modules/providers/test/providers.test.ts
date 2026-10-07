// The providers module: the shared registry's resolvers and providers.json (host/server/providers.ts), and the
// /api/providers routes. Every process call is faked — no real CLIs, no network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempDir } from "../../../host/test/harness.ts";
import * as providers from "../../../host/server/providers.ts";
import register from "../server/index.ts";

let findHits: Record<string, string> = {};
let runReply: (args: string[]) => { stdout?: string; err?: boolean } = () => ({ stdout: "" });
let runCalls: string[][] = [];

beforeEach(() => {
  findHits = {};
  runReply = () => ({ stdout: "" });
  runCalls = [];
  providers.providerExec.find = (name: string) => findHits[name] ?? null;
  providers.providerExec.run = ((_cmd: string, args: string[]) => {
    runCalls.push(args);
    const r = runReply(args);
    return r.err ? Promise.reject(new Error("boom")) : Promise.resolve({ stdout: r.stdout ?? "", stderr: "" });
  }) as unknown as typeof providers.providerExec.run;
});

const appPackageVersion = (): string =>
  (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;

test("resolveCli: posix finds the plain bin; win32 finds the .cmd shim and wraps it in cmd.exe", () => {
  const posix = providers.resolveCli(["opencode"], "linux", (n) => (n === "opencode" ? "/usr/bin/opencode" : null));
  assert.deepEqual(posix, { cmd: "/usr/bin/opencode", pre: [], path: "/usr/bin/opencode" });

  const win = providers.resolveCli(["opencode"], "win32", (n) => (n === "opencode.cmd" ? "C:\\tools\\opencode.cmd" : null));
  assert.deepEqual(win, {
    cmd: process.env.ComSpec ?? "cmd.exe",
    pre: ["/c", "C:\\tools\\opencode.cmd"],
    path: "C:\\tools\\opencode.cmd",
  });
});

test("resolveCli: on win32 the .cmd shim wins over a bare shell script of the same name", () => {
  // npm globals write gemini (sh), gemini.cmd and gemini.ps1 — only the .cmd is execFile-runnable.
  const both = (n: string) =>
    n === "gemini.cmd" ? "C:\\npm\\gemini.cmd" : n === "gemini" ? "C:\\npm\\gemini" : null;
  const hit = providers.resolveCli(["gemini"], "win32", both);
  assert.equal(hit?.path, "C:\\npm\\gemini.cmd");
  assert.deepEqual(hit?.pre, ["/c", "C:\\npm\\gemini.cmd"]);
});

test("resolveCli: nothing found is null; the first name in the list that resolves wins", () => {
  assert.equal(providers.resolveCli(["nope"], "linux", () => null), null);
  const hit = providers.resolveCli(["agy", "gemini"], "linux", (n) =>
    n === "gemini" ? "/usr/bin/gemini" : n === "agy" ? "/usr/bin/agy" : null);
  assert.equal(hit?.path, "/usr/bin/agy");
});

test("detectProvider: a CLI provider reports the path and the first line of --version", async () => {
  const meta = providers.providerById("opencode")!;
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = () => ({ stdout: "opencode 1.2.3\nmore output\n" });
  const p = await providers.detectProvider(meta, "linux");
  assert.equal(p.found, true);
  assert.equal(p.path, "/usr/bin/opencode");
  assert.equal(p.version, "opencode 1.2.3");
  assert.equal(p.install, meta.install.posix);
  assert.equal(p.loginHint, meta.loginHint);
  // run is called as (cmd, [...pre, "--version"]): a plain bin has pre=[], so args are just --version.
  assert.deepEqual(runCalls.at(-1), ["--version"]);
});

test("detectProvider: a failing --version still counts as found, with no version", async () => {
  const meta = providers.providerById("codex")!;
  findHits = { codex: "/usr/local/bin/codex" };
  runReply = () => ({ err: true });
  const p = await providers.detectProvider(meta, "linux");
  assert.equal(p.found, true);
  assert.equal(p.path, "/usr/local/bin/codex");
  assert.equal(p.version, null);
});

test("detectProvider: a missing CLI is not found and carries the platform install hint", async () => {
  const meta = providers.providerById("antigravity")!;
  const win = await providers.detectProvider(meta, "win32");
  assert.equal(win.found, false);
  assert.equal(win.path, null);
  assert.equal(win.version, null);
  assert.equal(win.install, meta.install.win32);
  const posix = await providers.detectProvider(meta, "linux");
  assert.equal(posix.install, meta.install.posix);
});

test("detectProvider: claude is the bundled SDK — found, no binary, version from apps/os/package.json", async () => {
  const meta = providers.providerById("claude")!;
  const p = await providers.detectProvider(meta);
  assert.equal(p.found, true);
  assert.equal(p.path, null);
  assert.equal(p.version, appPackageVersion());
});

test("detectAll: every registry provider, in registry order", async () => {
  const list = await providers.detectAll();
  assert.deepEqual(list.map((p) => p.id), ["claude", "opencode", "codex", "antigravity"]);
});

test("readProvidersFile: a missing file seeds enabled/default from the environment tools", () => {
  const file = join(tempDir(), "providers.json");
  // gemini is a CLI tool id but not a registry provider id — it is dropped.
  const seeded = providers.readProvidersFile(file, { claude: true, codex: true, gemini: true, opencode: false });
  assert.deepEqual(seeded, { enabled: ["claude", "codex"], default: "claude" });
  assert.deepEqual(providers.readProvidersFile(file), { enabled: ["claude"], default: "claude" });
  assert.deepEqual(providers.readProvidersFile(file, {}), { enabled: ["claude"], default: "claude" });
});

test("readProvidersFile: unknown ids are dropped and the default falls back to the first enabled", () => {
  const file = join(tempDir(), "providers.json");
  writeFileSync(file, JSON.stringify({ enabled: ["codex", "bogus", "opencode"], default: "bogus" }));
  assert.deepEqual(providers.readProvidersFile(file), { enabled: ["codex", "opencode"], default: "codex" });
  writeFileSync(file, JSON.stringify({ enabled: ["claude", "codex"], default: "codex" }));
  assert.deepEqual(providers.readProvidersFile(file), { enabled: ["claude", "codex"], default: "codex" });
  writeFileSync(file, JSON.stringify({ enabled: ["claude"], default: "claude" }));
  assert.deepEqual(providers.readProvidersFile(file), { enabled: ["claude"], default: "claude" });
});

test("writeProvidersFile: pretty JSON with a trailing newline, parent dirs created, default kept inside enabled", () => {
  const file = join(tempDir(), "nested", "providers.json");
  providers.writeProvidersFile(file, { enabled: ["codex", "claude"], default: "codex" });
  const text = readFileSync(file, "utf8");
  assert.equal(text, `${JSON.stringify({ enabled: ["codex", "claude"], default: "codex" }, null, 2)}\n`);
  providers.writeProvidersFile(file, { enabled: ["codex"], default: "claude" });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: ["codex"], default: "codex" });
});

const m = await mountModule(register, { id: "providers" });

test("GET /providers lists every registry provider with the seeded enabled set", async () => {
  const r = await m.get("/providers");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.enabled, ["claude"]);
  assert.equal(r.body.default, "claude");
  assert.deepEqual(
    r.body.providers.map((p: providers.DetectedProvider) => p.id),
    ["claude", "opencode", "codex", "antigravity"],
  );
  const claude = r.body.providers.find((p: providers.DetectedProvider) => p.id === "claude");
  assert.equal(claude.found, true);
  assert.equal(claude.path, null);
  assert.equal(claude.version, appPackageVersion());
  for (const id of ["opencode", "codex", "antigravity"]) {
    const p = r.body.providers.find((x: providers.DetectedProvider) => x.id === id);
    assert.equal(p.found, false, id);
    assert.ok(p.install.length > 0, `${id} carries an install hint`);
    assert.ok(p.loginHint.length > 0, `${id} carries a login hint`);
  }
});

test("POST /providers/enabled persists and filters unknown ids; the file is written", async () => {
  const r = await m.call("POST", "/providers/enabled", { enabled: ["codex", "bogus", "opencode"], default: "codex" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.enabled, ["codex", "opencode"]);
  assert.equal(r.body.default, "codex");
  const onDisk = JSON.parse(readFileSync(join(m.ctx.env.library, "providers.json"), "utf8")) as unknown;
  assert.deepEqual(onDisk, { enabled: ["codex", "opencode"], default: "codex" });
});

test("POST /providers/enabled rejects empty sets and a default outside enabled; null default falls back", async () => {
  assert.equal((await m.call("POST", "/providers/enabled", { enabled: [] })).status, 400);
  assert.equal((await m.call("POST", "/providers/enabled", { enabled: ["bogus"] })).status, 400);
  assert.equal((await m.call("POST", "/providers/enabled", { enabled: "claude" })).status, 400);
  assert.equal((await m.call("POST", "/providers/enabled", { enabled: ["claude"], default: "codex" })).status, 400);
  const ok = await m.call("POST", "/providers/enabled", { enabled: ["opencode", "claude"], default: null });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.enabled, ["opencode", "claude"]);
  assert.equal(ok.body.default, "opencode");
});

test("POST /providers/test re-detects one provider, bypassing the detect cache", async () => {
  const before = await m.get("/providers");
  const codexBefore = before.body.providers.find((p: providers.DetectedProvider) => p.id === "codex");
  assert.equal(codexBefore.found, false, "cached from the first GET");

  findHits = { codex: "C:\\tools\\codex.cmd" };
  runReply = () => ({ stdout: "codex 0.9.0\n" });
  const r = await m.call("POST", "/providers/test", { id: "codex" });
  assert.equal(r.status, 200);
  assert.equal(r.body.provider.id, "codex");
  assert.equal(r.body.provider.found, true);
  assert.equal(r.body.provider.path, "C:\\tools\\codex.cmd");
  assert.equal(r.body.provider.version, "codex 0.9.0");

  assert.equal((await m.call("POST", "/providers/test", { id: "bogus" })).status, 400);
});

// ---- askWithProvider (T2 headless runners) -------------------------------------------------
test("askWithProvider: headless argv per provider (opencode run / codex exec / agy -p)", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = () => ({ stdout: "  the answer\n" });
  const r = await providers.askWithProvider("opencode", "fix the bug", { cwd: "/tmp/proj" });
  assert.deepEqual(r, { text: "the answer", raw: "  the answer\n" });
  assert.deepEqual(runCalls.at(-1), ["run", "fix the bug"]);

  findHits = { codex: "/usr/local/bin/codex" };
  runReply = () => ({ stdout: "ok" });
  await providers.askWithProvider("codex", "do it", { cwd: "/tmp" });
  assert.deepEqual(runCalls.at(-1), ["exec", "do it"]);

  findHits = { agy: "/usr/bin/agy" };
  runReply = () => ({ stdout: "g" });
  await providers.askWithProvider("antigravity", "hello", { cwd: "/tmp" });
  assert.deepEqual(runCalls.at(-1), ["-p", "hello"]);
});

test("askWithProvider: a win32 .cmd shim resolves through cmd.exe /c with the headless argv after it", async () => {
  const seen: { cmd: string; args: string[] }[] = [];
  providers.providerExec.run = ((cmd: string, args: string[]) => {
    seen.push({ cmd, args });
    return Promise.resolve({ stdout: "ok", stderr: "" });
  }) as unknown as typeof providers.providerExec.run;
  findHits = { "codex.cmd": "C:\\tools\\codex.cmd" };
  await providers.askWithProvider("codex", "x", { cwd: "C:\\proj" });
  assert.equal(seen[0].cmd, process.env.ComSpec ?? "cmd.exe");
  assert.deepEqual(seen[0].args, ["/c", "C:\\tools\\codex.cmd", "exec", "x"]);
});

test("askWithProvider: non-zero exit is a 502 carrying a trimmed stderr tail; empty stdout is a 502", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  providers.providerExec.run = (() =>
    Promise.reject(Object.assign(new Error("Command failed"), { stderr: "line1\nline2\nAGENT ERROR: bad login\n", stdout: "" }))) as unknown as typeof providers.providerExec.run;
  await assert.rejects(
    providers.askWithProvider("opencode", "x", { cwd: "/tmp" }),
    (e: any) => e.status === 502 && /AGENT ERROR: bad login/.test(e.message),
  );
  providers.providerExec.run = (() => Promise.resolve({ stdout: "   \n", stderr: "" })) as unknown as typeof providers.providerExec.run;
  await assert.rejects(providers.askWithProvider("opencode", "x", { cwd: "/tmp" }), (e: any) => e.status === 502 && /no output/.test(e.message));
});

test("askWithProvider: claude is refused (SDK path), not spawned headless", async () => {
  await assert.rejects(providers.askWithProvider("claude", "x", { cwd: "/tmp" }), (e: any) => e.status === 502 && /SDK/.test(e.message));
});
