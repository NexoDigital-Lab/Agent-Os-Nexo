// The providers module: the shared registry's resolvers and providers.json (host/server/providers.ts), and the
// /api/providers routes. Every process call is faked — no real CLIs, no network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempDir, tempEnv } from "../../../host/test/harness.ts";
import * as providers from "../../../host/server/providers.ts";
import register from "../server/index.ts";

let findHits: Record<string, string> = {};
let runReply: (args: string[]) => { stdout?: string; err?: boolean } = () => ({ stdout: "" });
let runCalls: string[][] = [];

beforeEach(() => {
  findHits = {};
  runReply = () => ({ stdout: "" });
  runCalls = [];
  providers.clearChoicesCache();
  providers.providerExec.find = (name: string) => findHits[name] ?? null;
  providers.providerExec.run = ((_cmd: string, args: string[]) => {
    runCalls.push(args);
    const r = runReply(args);
    return r.err ? Promise.reject(new Error("boom")) : Promise.resolve({ stdout: r.stdout ?? "", stderr: "" });
  }) as unknown as typeof providers.providerExec.run;
});

const appPackageVersion = (): string =>
  (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;

test("resolveCli: posix finds the plain bin; on win32 npm's .cmd shim runs its script with node, never cmd.exe", () => {
  const posix = providers.resolveCli(["opencode"], "linux", (n) => (n === "opencode" ? "/usr/bin/opencode" : null));
  assert.deepEqual(posix, { cmd: "/usr/bin/opencode", pre: [], path: "/usr/bin/opencode", viaCmd: false });

  const find = (n: string) => (n === "opencode.cmd" ? "C:\\tools\\opencode.cmd" : null);
  const npm = providers.resolveCli(["opencode"], "win32", find, () => "C:\\tools\\node_modules\\opencode-ai\\bin\\opencode.js");
  assert.deepEqual(npm, { cmd: process.execPath, pre: ["C:\\tools\\node_modules\\opencode-ai\\bin\\opencode.js"], path: "C:\\tools\\opencode.cmd", viaCmd: false });

  // A shim that is not npm's: cmd.exe is the only way, flagged so askWithProvider guards its arguments.
  const other = providers.resolveCli(["opencode"], "win32", find, () => null);
  assert.deepEqual(other, { cmd: process.env.ComSpec ?? "cmd.exe", pre: ["/c", "C:\\tools\\opencode.cmd"], path: "C:\\tools\\opencode.cmd", viaCmd: true });
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
  assert.deepEqual(list.map((p) => p.id), ["claude", "opencode", "codex", "antigravity", "gemini"]);
});

test("the registry knows five providers; antigravity is agy-only and gemini is its own entry", () => {
  assert.deepEqual(providers.PROVIDERS.map((p) => p.id), ["claude", "opencode", "codex", "antigravity", "gemini"]);
  // The legacy `gemini` fallback binary moved out of antigravity into the gemini provider.
  assert.deepEqual(providers.providerById("antigravity")!.binaries, ["agy"]);
  const agyInstall = providers.providerById("antigravity")!.install;
  assert.match(agyInstall.win32, /antigravity\.google/);
  assert.doesNotMatch(agyInstall.win32, /gemini-cli/, "the install hint is agy-only");
  const gemini = providers.providerById("gemini")!;
  assert.equal(gemini.label, "Gemini CLI");
  assert.equal(gemini.kind, "cli");
  assert.deepEqual(gemini.binaries, ["gemini"]);
  assert.match(gemini.install.win32, /@google\/gemini-cli/);
  assert.match(gemini.install.posix, /@google\/gemini-cli/);
  assert.ok(gemini.loginHint.length > 0, "gemini carries a login hint");
  assert.ok(gemini.install.win32.length > 0 && gemini.install.posix.length > 0);
});

test("readProvidersFile: a missing file seeds enabled/default from the environment tools", () => {
  const file = join(tempDir(), "providers.json");
  // The CLI's tools ids line up with the registry (gemini became a registry provider in round 2); off=false is dropped.
  const seeded = providers.readProvidersFile(file, { claude: true, codex: true, gemini: true, opencode: false });
  assert.deepEqual(seeded, { enabled: ["claude", "codex", "gemini"], default: "claude" });
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
    ["claude", "opencode", "codex", "antigravity", "gemini"],
  );
  const claude = r.body.providers.find((p: providers.DetectedProvider) => p.id === "claude");
  assert.equal(claude.found, true);
  assert.equal(claude.path, null);
  assert.equal(claude.version, appPackageVersion());
  for (const id of ["opencode", "codex", "antigravity", "gemini"]) {
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
  assert.deepEqual(runCalls.at(-1), ["exec", "--sandbox", "read-only", "do it"]);

  findHits = { agy: "/usr/bin/agy" };
  runReply = () => ({ stdout: "g" });
  await providers.askWithProvider("antigravity", "hello", { cwd: "/tmp" });
  assert.deepEqual(runCalls.at(-1), ["-p", "hello"]);
});

test("askWithProvider: through a non-npm .cmd launcher, a prompt cmd.exe would interpret is refused before spawning", async () => {
  const seen: { cmd: string; args: string[] }[] = [];
  providers.providerExec.run = ((cmd: string, args: string[]) => {
    seen.push({ cmd, args });
    return Promise.resolve({ stdout: "ok", stderr: "" });
  }) as unknown as typeof providers.providerExec.run;
  findHits = { "codex.cmd": "C:\\tools\\codex.cmd" }; // not a real file: no npm script to read → cmd.exe fallback
  if (process.platform === "win32") {
    await providers.askWithProvider("codex", "x", { cwd: "C:\\proj" });
    assert.deepEqual(seen[0]?.args, ["/c", "C:\\tools\\codex.cmd", "exec", "--sandbox", "read-only", "x"]);
    await assert.rejects(providers.askWithProvider("codex", "fix a&calc.exe", { cwd: "C:\\proj" }), (e: any) => e.status === 502 && /Reinstall it with npm/.test(e.message));
    assert.equal(seen.length, 1, "the dangerous prompt never ran");
  } else {
    // Elsewhere a .cmd hit only happens in tests; the guard is the same code path.
    await assert.rejects(providers.askWithProvider("codex", "fix a&calc.exe", { cwd: "/p" }), (e: any) => e.status === 502);
    assert.equal(seen.length, 0);
  }
});

test("askWithProvider: Stop aborts the CLI (the signal reaches the spawn) and answers 499; a prompt too long is a 413", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  let passed: AbortSignal | undefined;
  providers.providerExec.run = ((_c: string, _a: string[], opts: { signal?: AbortSignal }) => {
    passed = opts.signal;
    return new Promise((_r, reject) => opts.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  }) as unknown as typeof providers.providerExec.run;
  const ac = new AbortController();
  const pending = providers.askWithProvider("opencode", "go", { cwd: "/p", signal: ac.signal });
  ac.abort();
  await assert.rejects(pending, (e: any) => e.status === 499);
  assert.equal(passed, ac.signal);
  await assert.rejects(providers.askWithProvider("opencode", "x".repeat(providers.MAX_PROMPT_ARG + 1), { cwd: "/p" }), (e: any) => e.status === 413);
});

test("modeArgs: Codex read-only unless edits are accepted (never danger-full-access); OpenCode --auto only on bypass", () => {
  assert.deepEqual(providers.modeArgs("codex", "default"), ["--sandbox", "read-only"]);
  assert.deepEqual(providers.modeArgs("codex", "plan"), ["--sandbox", "read-only"]);
  assert.deepEqual(providers.modeArgs("codex", "acceptEdits"), ["--sandbox", "workspace-write"]);
  assert.deepEqual(providers.modeArgs("codex", "bypassPermissions"), ["--sandbox", "workspace-write"]);
  assert.deepEqual(providers.modeArgs("codex", "auto"), ["--sandbox", "read-only"], "an unknown mode is the safe default");
  assert.deepEqual(providers.modeArgs("opencode", "bypassPermissions"), ["--auto"]);
  assert.deepEqual(providers.modeArgs("opencode", "acceptEdits"), []);
  assert.deepEqual(providers.modeArgs("gemini", "bypassPermissions"), []);
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

// ---- T3: model/agent selection ---------------------------------------------------------------
test("headlessArgs argv: opencode --model/--agent, codex --model/--profile, antigravity --model/--agent, gemini --model/--extensions", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = () => ({ stdout: "ok" });
  await providers.askWithProvider("opencode", "fix", { cwd: "/tmp", model: "opencode/mimo-v2.6-pro", agent: "build" });
  assert.deepEqual(runCalls.at(-1), ["run", "--model", "opencode/mimo-v2.6-pro", "--agent", "build", "fix"]);

  await providers.askWithProvider("opencode", "fix", { cwd: "/tmp", model: "opencode/mimo" });
  assert.deepEqual(runCalls.at(-1), ["run", "--model", "opencode/mimo", "fix"]);

  await providers.askWithProvider("opencode", "fix", { cwd: "/tmp", agent: "build" });
  assert.deepEqual(runCalls.at(-1), ["run", "--agent", "build", "fix"]);

  findHits = { codex: "/usr/local/bin/codex" };
  await providers.askWithProvider("codex", "do", { cwd: "/tmp", model: "gpt-5" });
  assert.deepEqual(runCalls.at(-1), ["exec", "--sandbox", "read-only", "--model", "gpt-5", "do"]);

  await providers.askWithProvider("codex", "do", { cwd: "/tmp", agent: "deep-review" });
  assert.deepEqual(runCalls.at(-1), ["exec", "--sandbox", "read-only", "--profile", "deep-review", "do"]);

  await providers.askWithProvider("codex", "do", { cwd: "/tmp", model: "gpt-5.5", agent: "deep-review" });
  assert.deepEqual(runCalls.at(-1), ["exec", "--sandbox", "read-only", "--model", "gpt-5.5", "--profile", "deep-review", "do"]);

  await providers.askWithProvider("codex", "do", { cwd: "/tmp" });
  assert.deepEqual(runCalls.at(-1), ["exec", "--sandbox", "read-only", "do"]);

  findHits = { agy: "/usr/bin/agy" };
  await providers.askWithProvider("antigravity", "hi", { cwd: "/tmp", model: "gemini-3.5-flash-medium", agent: "planner" });
  assert.deepEqual(runCalls.at(-1), ["-p", "hi", "--model", "gemini-3.5-flash-medium", "--agent", "planner"]);

  await providers.askWithProvider("antigravity", "hi", { cwd: "/tmp" });
  assert.deepEqual(runCalls.at(-1), ["-p", "hi"]);

  findHits = { gemini: "/usr/bin/gemini" };
  await providers.askWithProvider("gemini", "hi", { cwd: "/tmp", model: "Gemini 3.5 Flash (Medium)", agent: "docs-helper" });
  assert.deepEqual(runCalls.at(-1), ["-p", "hi", "--model", "Gemini 3.5 Flash (Medium)", "--extensions", "docs-helper"]);

  await providers.askWithProvider("gemini", "hi", { cwd: "/tmp" });
  assert.deepEqual(runCalls.at(-1), ["-p", "hi"]);
});

test("askWithProvider rejects malformed model/agent with 400 before spawning", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = () => ({ stdout: "ok" });
  await assert.rejects(
    providers.askWithProvider("opencode", "x", { cwd: "/tmp", model: "bad model!" }),
    (e: any) => e.status === 400 && /Invalid model/.test(e.message),
  );
  await assert.rejects(
    providers.askWithProvider("opencode", "x", { cwd: "/tmp", agent: "bad agent!" }),
    (e: any) => e.status === 400 && /Invalid agent/.test(e.message),
  );
  assert.equal(runCalls.length, 0, "nothing was spawned");
  // Valid shapes pass through
  await providers.askWithProvider("opencode", "x", { cwd: "/tmp", model: "opencode/mimo-v2.6-pro", agent: "sdd-orchestador" });
  assert.equal(runCalls.length, 1);
});

test("listProviderChoices parses opencode agent-list and models output, and caches per id+cwd", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = (args) => {
    if (args.includes("agent")) return { stdout: "build (primary)\nexplore (subagent)\ngentle-ai-worker (subagent)\n" };
    if (args.includes("models")) return { stdout: "opencode/mimo-v2.6-flash-free\nopencode/mimo-v2.6-pro\n" };
    return { stdout: "" };
  };
  const r1 = await providers.listProviderChoices("opencode", "/proj");
  assert.deepEqual(r1, { agents: ["build", "explore", "gentle-ai-worker"], models: ["opencode/mimo-v2.6-flash-free", "opencode/mimo-v2.6-pro"] });
  assert.equal(runCalls.length, 2);
  // Second call within TTL is cached: no additional CLI calls
  const r2 = await providers.listProviderChoices("opencode", "/proj");
  assert.deepEqual(r2, r1);
  assert.equal(runCalls.length, 2, "second call is cached");
  // Different cwd: cache miss
  await providers.listProviderChoices("opencode", "/other");
  assert.equal(runCalls.length, 4);
  // clearChoicesCache forces a fresh call
  providers.clearChoicesCache();
  await providers.listProviderChoices("opencode", "/proj");
  assert.equal(runCalls.length, 6);
});

test("listProviderChoices: failures return empty lists; claude never spawns; codex scans the fs; agy/gemini spawn only when installed", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = () => ({ err: true });
  assert.deepEqual(await providers.listProviderChoices("opencode", "/proj"), { agents: [], models: [] });
  assert.equal(runCalls.length, 2, "both opencode commands were attempted before the catch");

  // codex: profiles come from a $CODEX_HOME scan — an empty dir is an empty list and nothing spawns.
  const home = tempDir("codex-home-empty-");
  const prevHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    assert.deepEqual(await providers.listProviderChoices("codex", "/proj"), { agents: [], models: [] });
    assert.equal(runCalls.length, 2, "codex never spawns a CLI for its choices");
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevHome;
  }

  // Not installed: no binary resolves, so nothing spawns (the ENOENT-style failure arrives when a binary
  // resolves but the run rejects — the next block).
  const beforeIdle = runCalls.length;
  assert.deepEqual(await providers.listProviderChoices("antigravity", "/proj"), { agents: [], models: [] });
  assert.deepEqual(await providers.listProviderChoices("gemini", "/proj"), { agents: [], models: [] });
  assert.deepEqual(await providers.listProviderChoices("claude", "/proj"), { agents: [], models: [] });
  assert.equal(runCalls.length, beforeIdle, "ids without an installed CLI never spawn");

  // Installed but failing (ENOENT / nonzero exit / timeout): both agy commands are attempted, then it degrades.
  findHits = { agy: "/usr/bin/agy" };
  const beforeBroken = runCalls.length;
  assert.deepEqual(await providers.listProviderChoices("antigravity", "/broken"), { agents: [], models: [] });
  assert.equal(runCalls.length, beforeBroken + 2, "`agy agents` and `agy models` were attempted before the catch");
});

test("listProviderChoices: codex profiles come from a $CODEX_HOME scan (files + legacy tables), sorted and deduped", async () => {
  const home = tempDir("codex-home-");
  writeFileSync(join(home, "deep-review.config.toml"), 'model = "gpt-5.5"\n');
  writeFileSync(join(home, "planner.config.toml"), "");
  // Legacy codex (<0.134) keeps profiles as [profiles.<name>] tables inside config.toml — which is never
  // a profile name itself.
  writeFileSync(join(home, "config.toml"), '# legacy\n[profiles.legacy-one]\nmodel = "gpt-5"\n[profiles.deep-review]\nmodel = "x"\n');
  const prevHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    const r = await providers.listProviderChoices("codex", "/proj");
    assert.deepEqual(r, { agents: ["deep-review", "legacy-one", "planner"], models: [] });
    assert.equal(runCalls.length, 0, "codex choices never spawn a CLI");
    // Cached per id+cwd like the other branches (still no spawn).
    assert.deepEqual(await providers.listProviderChoices("codex", "/proj"), r);
    assert.equal(runCalls.length, 0);
    // A missing dir degrades to an empty list (and is not cached: the next call rescans).
    providers.clearChoicesCache();
    process.env.CODEX_HOME = join(home, "missing");
    assert.deepEqual(await providers.listProviderChoices("codex", "/other"), { agents: [], models: [] });
    assert.equal(runCalls.length, 0);
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevHome;
  }
});

test("listProviderChoices: `agy agents`/`agy models` output is parsed conservatively — prose, logs and long lines degrade away", async () => {
  findHits = { agy: "/usr/bin/agy" };
  const longName = `model-${"x".repeat(80)}`; // > 80 chars: dropped even without a colon
  runReply = (args) => {
    if (args.includes("agents")) {
      // ANSI colour, CRLF, list/table decoration, an MCP-style log line and a sentence: only the names survive.
      return { stdout: "\u001b[32mbuild\u001b[0m (primary)\r\n- planner\r\n• reviewer\r\n| tester\r\n14:32:11 INFO registered MCP server foo:bar\r\nNo agent named that.\r\n" };
    }
    if (args.includes("models")) {
      return { stdout: `gemini-3.5-flash-medium\r\nGemini 3.5 Flash (Medium)\r\n${longName}\r\n` };
    }
    return { stdout: "" };
  };
  assert.deepEqual(await providers.listProviderChoices("antigravity", "/agy-proj"), {
    agents: ["build", "planner", "reviewer", "tester"],
    models: ["gemini-3.5-flash-medium", "Gemini 3.5 Flash (Medium)"],
  });
  assert.equal(runCalls.length, 2);
});

test("listProviderChoices: `gemini -l` lists extensions (agents) and never models; noise lines are dropped", async () => {
  findHits = { gemini: "/usr/bin/gemini" };
  runReply = () => ({ stdout: "docs-helper\r\n- code-reviewer\r\nNo extensions installed.\r\n" });
  assert.deepEqual(await providers.listProviderChoices("gemini", "/gem-proj"), {
    agents: ["docs-helper", "code-reviewer"],
    models: [],
  });
  assert.deepEqual(runCalls.at(-1), ["-l"], "`gemini -l` is the list-and-exit flag");
});

test("listProviderChoices: a failed gemini run is not cached — the next call spawns again", async () => {
  findHits = { gemini: "/usr/bin/gemini" };
  runReply = () => ({ err: true }); // a cold CLI that fails its first attempt
  assert.deepEqual(await providers.listProviderChoices("gemini", "/cold"), { agents: [], models: [] });
  assert.equal(runCalls.length, 1, "`gemini -l` was attempted");
  runReply = () => ({ stdout: "docs-helper\n" });
  const r = await providers.listProviderChoices("gemini", "/cold"); // still inside the TTL window
  assert.deepEqual(r, { agents: ["docs-helper"], models: [] }, "a cold empty result must not poison the cache");
  assert.equal(runCalls.length, 2, "the retry spawned again instead of serving the cached empty");
  await providers.listProviderChoices("gemini", "/cold"); // a successful non-empty answer IS cached
  assert.equal(runCalls.length, 2);
});

test("listProviderChoices: an empty (failed) run is not cached — the next call retries", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = () => ({ err: true }); // first call fails, e.g. a cold CLI that timed out
  assert.deepEqual(await providers.listProviderChoices("opencode", "/fresh"), { agents: [], models: [] });
  assert.equal(runCalls.length, 2);
  runReply = (args) => {
    if (args.includes("agent")) return { stdout: "build (primary)\n" };
    if (args.includes("models")) return { stdout: "opencode/mimo-v2.6-pro\n" };
    return { stdout: "" };
  };
  const r = await providers.listProviderChoices("opencode", "/fresh"); // still inside the TTL window
  assert.deepEqual(r, { agents: ["build"], models: ["opencode/mimo-v2.6-pro"] }, "a cold empty result must not poison the cache");
  assert.equal(runCalls.length, 4, "the retry spawned again instead of serving the cached empty");
});

// ---- choices route (T3) --------------------------------------------------------------------------
const { initProjects } = await import("../../projects/server/projects.ts");
const projectsEnv = tempEnv();
mkdirSync(join(projectsEnv.projects, "shop", "code"), { recursive: true });
writeFileSync(join(projectsEnv.projects, "shop", "AGENTS.md"), "# shop");
initProjects(projectsEnv);

test("GET /providers/choices: 400 for an unknown id; antigravity and gemini answer 200 with (usually empty) lists; 404 for unknown project", async () => {
  assert.equal((await m.get("/providers/choices?id=bogus&project=shop")).status, 400);
  // Neither agy nor gemini is installed on this machine: 200 with empty lists, not an error.
  assert.deepEqual((await m.get("/providers/choices?id=antigravity&project=shop")).body, { agents: [], models: [] });
  assert.deepEqual((await m.get("/providers/choices?id=gemini&project=shop")).body, { agents: [], models: [] });
  assert.equal((await m.get("/providers/choices?id=opencode&project=nope")).status, 404);
});

test("GET /providers/choices: claude has supports.model but listProviderChoices returns empty (not opencode)", async () => {
  const r = await m.get("/providers/choices?id=claude&project=shop");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { agents: [], models: [] });
});

test("GET /providers/choices: opencode returns parsed choices from the project cwd", async () => {
  findHits = { opencode: "/usr/bin/opencode" };
  runReply = (args) => {
    if (args.includes("agent")) return { stdout: "build (primary)\nexplore (subagent)\n" };
    if (args.includes("models")) return { stdout: "opencode/mimo-a\n" };
    return { stdout: "" };
  };
  providers.clearChoicesCache();
  const r = await m.get("/providers/choices?id=opencode&project=shop");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { agents: ["build", "explore"], models: ["opencode/mimo-a"] });
});

test("ProviderMeta carries supports; claude model-only, opencode/codex/antigravity/gemini agent+model", () => {
  assert.deepEqual(providers.providerById("claude")!.supports, { model: true });
  assert.deepEqual(providers.providerById("opencode")!.supports, { agent: true, model: true });
  assert.deepEqual(providers.providerById("codex")!.supports, { agent: true, model: true });
  assert.deepEqual(providers.providerById("antigravity")!.supports, { agent: true, model: true });
  assert.deepEqual(providers.providerById("gemini")!.supports, { agent: true, model: true });
});

// ---- CHOICE_RE: what a model id may contain --------------------------------------------------
test("CHOICE_RE accepts provider ids and display names; shell metacharacters and control chars never pass", () => {
  for (const ok of ["gpt-5.5", "openai/gpt-5.4", "Gemini 3.5 Flash (Medium)", "gpt-5:mini", "opencode/mimo-v2.6-pro", "gpt_5@preview", "a".repeat(200)]) {
    assert.match(ok, providers.CHOICE_RE, `should accept: ${JSON.stringify(ok)}`);
  }
  for (const bad of ["bad model!", "$(whoami)", "`ls`", "a;b", "x|y", "p>q", "a\nb", "  lead", "-dash", "", "a".repeat(201)]) {
    assert.doesNotMatch(bad, providers.CHOICE_RE, `should reject: ${JSON.stringify(bad)}`);
  }
});
