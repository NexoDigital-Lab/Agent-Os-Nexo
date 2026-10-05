import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { init } from "../src/commands/init.ts";
import { update } from "../src/commands/update.ts";
import { diagnose, staleAnalysis } from "../src/commands/doctor.ts";
import { analyze } from "../src/commands/analyze.ts";
import { clone, create } from "../src/commands/project.ts";
import { connect } from "../src/commands/connect.ts";
import { os } from "../src/commands/os.ts";
import { readConfig } from "../src/core/config.ts";
import { copySource, runtimeHash, type Runner } from "../src/core/osruntime.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("init builds the agreed layout", async () => {
  const root = await freshEnv();
  for (const rel of [
    "AGENTS.md",
    "environment.config.json",
    ".claude/CLAUDE.md",
    ".claude/settings.json",
    ".gemini/settings.json",
    "library/index.json",
    "library/profile.json",
    "library/permissions.json",
    "library/memory/index.json",
    "library/skills/nexo-dev/SKILL.md",
    "library/conventions/git/README.md",
    "library/hooks/scripts/block-force-push.mjs",
    "blueprints/index.json",
    "os/source",
    "os/versions",
    "os/data",
    "projects",
    ".state",
  ]) {
    assert.ok(existsSync(join(root, rel)), `missing ${rel}`);
  }
  assert.equal(readFileSync(join(root, ".claude/CLAUDE.md"), "utf8"), "@../AGENTS.md\n");
  const config = readConfig(root);
  assert.equal(config.tools.claude, true);
  assert.equal(config.tools.codex, false);
  assert.equal(config.system, null);
  assert.deepEqual(json(join(root, "library/profile.json")).identity, { name: "Tester", email: "tester@example.com" });
  const index = json(join(root, "library/index.json"));
  assert.ok(index.skills.some((s: { name: string }) => s.name === "nexo-dev"));
});

test("init --factory core installs only the core workflow; update --factory all adds the rest", async () => {
  const root = join(tempDir(), "env");
  await init({ root, yes: true, tools: "claude", factory: "core", name: "T", email: "t@example.com", language: "en" });
  for (const rel of ["skills/nexo-dev", "skills/nexo-features", "skills/nexo-idea", "skills/nexo-onboard", "conventions/git", "hooks/block-force-push.json", "hooks/scripts/block-force-push.mjs"]) {
    assert.ok(existsSync(join(root, "library", rel)), `missing ${rel}`);
  }
  for (const rel of ["skills/nexo-research", "agents/planner.md", "commands/os-analysis.json", "hooks/session-start-doctor.json"]) {
    assert.ok(!existsSync(join(root, "library", rel)), `unexpected ${rel}`);
  }
  assert.equal(readConfig(root).factory, "core");
  const out = update({ root, factory: "all" });
  assert.match(out, /agents\/planner\.md/);
  assert.ok(existsSync(join(root, "library/skills/nexo-research/SKILL.md")));
  assert.equal(readConfig(root).factory, "all");
});

test("init --factory none installs no factory items", async () => {
  const root = join(tempDir(), "env");
  await init({ root, yes: true, tools: "claude", factory: "none", name: "T", email: "t@example.com", language: "en" });
  assert.deepEqual(readdirSync(join(root, "library/skills")), []);
  assert.ok(!existsSync(join(root, "library/hooks/scripts")));
  assert.throws(() => update({ root, factory: "some" }), /Unknown factory set/);
});

test("Claude sees the library: .claude/skills links to it and agents get Claude's tool names", async () => {
  const root = await freshEnv("claude");
  assert.ok(lstatSync(join(root, ".claude/skills")).isSymbolicLink());
  assert.equal(readlinkSync(join(root, ".claude/skills")), "../library/skills");
  assert.ok(existsSync(join(root, ".claude/skills/nexo-dev/SKILL.md")));
  const planner = readFileSync(join(root, ".claude/agents/planner.md"), "utf8");
  assert.match(planner, /^---\nname: planner\n/);
  assert.match(planner, /\ntools: Read, Grep, Glob\n/);
  assert.match(planner, /\nmodel: sonnet\n/);
  assert.doesNotMatch(planner, /owner:/);
  create("shop", { root });
  assert.equal(readlinkSync(join(root, "projects/shop/.claude/skills")), "../../../library/skills");
  assert.ok(existsSync(join(root, "projects/shop/.claude/agents/code-reviewer.md")));
  // an agent removed from the library disappears from .claude/agents; a file the user put there stays
  writeFileSync(join(root, "library/agents/scout.md"), "---\nname: scout\ndescription: d\nowner: user\ntools: [read]\n---\nlook\n");
  update({ root });
  assert.match(readFileSync(join(root, ".claude/agents/scout.md"), "utf8"), /tools: Read\n/);
  rmSync(join(root, "library/agents/scout.md"));
  writeFileSync(join(root, ".claude/agents/mine.md"), "---\nname: mine\n---\nhi\n");
  update({ root });
  assert.ok(!existsSync(join(root, ".claude/agents/scout.md")));
  assert.ok(existsSync(join(root, ".claude/agents/mine.md")));
});

test("init refuses an existing environment and unknown options", async () => {
  const root = await freshEnv();
  await assert.rejects(init({ root, yes: true }), /already holds/);
  await assert.rejects(init({ root: join(tempDir(), "x"), yes: true, tools: "copilot" }), /Unknown AI/);
  await assert.rejects(init({ root: join(tempDir(), "y"), yes: true, preset: "yolo" }), /Unknown preset/);
});

test("doctor: a fresh environment only asks for an OS analysis", async () => {
  const root = await freshEnv();
  const findings = diagnose(root);
  assert.deepEqual(findings.map((f) => f.area), ["analysis"]);
  assert.equal(findings[0]?.level, "warn");
});

test("doctor: flags broken skills and agents above the model ceiling", async () => {
  const root = await freshEnv();
  writeFileSync(join(root, "library/skills/nexo-dev/SKILL.md"), "no frontmatter here\n");
  writeFileSync(
    join(root, "library/agents/big.md"),
    "---\nname: big\ndescription: d\nowner: user\nmodel: opus\n---\nbody\n",
  );
  const findings = diagnose(root);
  assert.ok(findings.some((f) => f.area === "skill nexo-dev" && f.level === "error"));
  assert.ok(findings.some((f) => f.area === "agent big.md" && /ceiling/.test(f.message)));
});

test("doctor: analysis staleness after 7 days", async () => {
  const root = await freshEnv();
  const config = readConfig(root);
  config.system = { os: "x", release: "1", arch: "x64", shell: "sh", packageManager: null, toolchains: {}, lastAnalysis: "2026-01-01T00:00:00Z" };
  assert.equal(staleAnalysis(config, new Date("2026-01-05T00:00:00Z")), null);
  assert.match(staleAnalysis(config, new Date("2026-01-20T00:00:00Z")) ?? "", /days old/);
});

test("analyze records the OS summary and clears the doctor warning", async () => {
  const root = await freshEnv();
  analyze({ root });
  const system = readConfig(root).system;
  assert.ok(system);
  assert.equal(system.toolchains.node, process.versions.node);
  assert.deepEqual(diagnose(root), []);
});

test("update keeps user-owned items and restores factory ones", async () => {
  const root = await freshEnv();
  const userSkill = join(root, "library/skills/nexo-idea/SKILL.md");
  writeFileSync(userSkill, readFileSync(userSkill, "utf8").replace("owner: nexo", "owner: user") + "\nmine\n");
  const factorySkill = join(root, "library/skills/nexo-dev/SKILL.md");
  writeFileSync(factorySkill, readFileSync(factorySkill, "utf8") + "\nlocal edit\n");
  rmSync(join(root, "library/agents/planner.md"));

  const out = update({ root });
  assert.match(readFileSync(userSkill, "utf8"), /mine/);
  assert.doesNotMatch(readFileSync(factorySkill, "utf8"), /local edit/);
  assert.ok(existsSync(join(root, "library/agents/planner.md")));
  assert.match(out, /kept \(owner is not nexo\): .*nexo-idea/);
});

test("new: single project and workspace part", async () => {
  const root = await freshEnv();
  create("demo", { root });
  assert.ok(existsSync(join(root, "projects/demo/code/.git")));
  assert.match(readFileSync(join(root, "projects/demo/AGENTS.md"), "utf8"), /^# AGENTS\.md — demo/);
  assert.ok(existsSync(join(root, "projects/demo/.claude/CLAUDE.md")));
  assert.ok(existsSync(join(root, "projects/demo/secrets/.gitignore")));

  create("api", { root, ws: "shop" });
  assert.ok(existsSync(join(root, "projects/shop-ws/AGENTS.md")));
  assert.ok(existsSync(join(root, "projects/shop-ws/context/README.md")));
  assert.ok(!existsSync(join(root, "projects/shop-ws/secrets")), "a workspace has no secrets of its own");
  assert.ok(existsSync(join(root, "projects/shop-ws/api/code/.git")));
  assert.throws(() => create("demo", { root }), /already exists/);
});

test("clone: copies a repo into code/ and cleans up on failure", async () => {
  const root = await freshEnv();
  const origin = join(tempDir(), "origin");
  execFileSync("git", ["init", "-q", origin]);
  writeFileSync(join(origin, "README.md"), "hello\n");
  execFileSync("git", ["-C", origin, "add", "."]);
  execFileSync("git", ["-C", origin, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init"]);

  clone(origin, { root, name: "origin-app" });
  assert.equal(readFileSync(join(root, "projects/origin-app/code/README.md"), "utf8"), "hello\n");

  assert.throws(() => clone(join(tempDir(), "missing-repo"), { root, name: "broken" }));
  assert.ok(!existsSync(join(root, "projects/broken")), "failed clone leaves nothing behind");
});

test("connect: MCP servers reach each AI's config; remote ones are only registered", async () => {
  const root = await freshEnv();
  connect("notion", { root, command: "npx", args: "-y,notion-mcp", env: ["NOTION_TOKEN=abc"], description: "Notion" });
  connect("drive", { root, remote: true, description: "Drive via claude.ai", tools: "claude" });
  assert.deepEqual(json(join(root, ".mcp.json")).mcpServers.notion, { command: "npx", args: ["-y", "notion-mcp"], env: { NOTION_TOKEN: "abc" } });
  assert.equal(json(join(root, ".mcp.json")).mcpServers.drive, undefined);
  assert.ok(json(join(root, ".gemini/settings.json")).mcpServers.notion);
  const names = json(join(root, "library/index.json")).connections.map((c: { name: string }) => c.name);
  assert.deepEqual(names, ["drive", "notion"]);
  assert.throws(() => connect("bad", { root }), /--command/);
});

test("os: versions, next and pinning", async () => {
  const root = await freshEnv();
  assert.match(await os(undefined, undefined, { root }), /not installed: `nexo os install`/);
  assert.equal(await os("next", undefined, { root }), "1.0.0");
  for (const v of ["1.0.0", "1.0.9"]) execFileSync("mkdir", ["-p", join(root, "os/versions", v)]);
  assert.equal(await os("next", undefined, { root }), "1.1.0");
  assert.equal(await os("versions", undefined, { root }), "  1.0.0\n* 1.0.9");
  await os("use", "1.0.0", { root });
  assert.equal(await os("versions", undefined, { root }), "* 1.0.0\n  1.0.9");
  await os("use", "latest", { root });
  assert.equal(await os("versions", undefined, { root }), "  1.0.0\n* 1.0.9");
  await assert.rejects(os("use", "3.0.0", { root }), /No build/);
});

// ── agent-os lifecycle: a fake source and a fake runner (no network, no real npm) ────────────────────────────────

// A server that answers like agent-os (200 + X-Agent-OS on /api/os/info), so start/stop can be tested for real.
const FAKE_MAIN = `import http from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http.createServer((_q, s) => { s.setHeader("X-Agent-OS", "1"); s.end("{}"); }).listen(port, "127.0.0.1");
`;

function fakeOsSource(deps: Record<string, string> = { express: "^5" }): string {
  const src = join(tempDir(), "agent-os");
  mkdirSync(join(src, "modules", "shell"), { recursive: true });
  mkdirSync(join(src, "scripts"), { recursive: true });
  mkdirSync(join(src, "host", "server"), { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "@nexodigital-lab/agent-os", dependencies: deps }));
  writeFileSync(join(src, "scripts", "build.ts"), "// real builds run Vite; the fake runner stands in for it\n");
  writeFileSync(join(src, "host", "server", "main.ts"), FAKE_MAIN);
  for (const junk of ["node_modules/x", "dist/web", ".git"]) mkdirSync(join(src, junk), { recursive: true });
  return src;
}

/** npm install makes node_modules; the build script copies the fake server into --out. */
function fakeRunner(calls: string[][]): Runner {
  return (cmd, args, cwd) => {
    calls.push([cmd, ...args]);
    if (cmd === "npm" && args[0] === "install") mkdirSync(join(cwd, "node_modules"), { recursive: true });
    if (cmd === process.execPath) {
      const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))!.slice(name.length + 3);
      const out = opt("out");
      mkdirSync(join(out, "host", "server"), { recursive: true });
      writeFileSync(join(out, "host", "server", "main.ts"), FAKE_MAIN);
      writeFileSync(join(out, "build.json"), JSON.stringify({ version: opt("version"), notes: opt("notes") }));
    }
  };
}

test("copySource leaves dependencies, builds and git out, and refuses what isn't agent-os", () => {
  const src = fakeOsSource();
  const dst = join(tempDir(), "copy");
  copySource(src, dst);
  assert.ok(existsSync(join(dst, "modules", "shell")));
  for (const junk of ["node_modules", "dist", ".git"]) assert.ok(!existsSync(join(dst, junk)), junk);
  assert.throws(() => copySource(tempDir(), join(tempDir(), "x")), /not an agent-os source/);
});

test("runtimeHash depends on the dependency set, not on key order", () => {
  assert.equal(runtimeHash({ dependencies: { a: "1", b: "2" } }), runtimeHash({ dependencies: { b: "2" }, devDependencies: { a: "1" } }));
  assert.notEqual(runtimeHash({ dependencies: { a: "1" } }), runtimeHash({ dependencies: { a: "2" } }));
});

test("os install copies the source, installs one shared runtime, and builds 1.0.0", async () => {
  const root = await freshEnv("claude");
  const calls: string[][] = [];
  const run = fakeRunner(calls);
  const out = await os("install", undefined, { root, from: fakeOsSource() }, run);
  assert.match(out, /built as 1\.0\.0/);
  const osDir = join(root, "os");
  assert.ok(existsSync(join(osDir, "source", "modules", "shell")));
  assert.ok(!existsSync(join(osDir, "source", "dist")));
  const runtimes = readdirSync(join(osDir, "runtime"));
  assert.equal(runtimes.length, 1);
  for (const dir of ["source", "versions/1.0.0"]) {
    assert.ok(lstatSync(join(osDir, dir, "node_modules")).isSymbolicLink(), `${dir}/node_modules is a link`);
    assert.equal(readlinkSync(join(osDir, dir, "node_modules")), join(osDir, "runtime", runtimes[0]!, "node_modules"));
  }
  await assert.rejects(os("install", undefined, { root }, run), /already installed/);

  // A second build reuses the runtime: npm install ran once.
  assert.match(await os("build", undefined, { root, notes: "tweak" }, run), /Built 1\.0\.1/);
  assert.equal(calls.filter((c) => c[0] === "npm").length, 1);
  assert.ok(!existsSync(join(osDir, "versions", "1.0.1.building")));
  assert.match(await os("status", undefined, { root }), /agent-os 1\.0\.1 \(of 2 build/);
});

test("a failed build leaves no version behind", async () => {
  const root = await freshEnv("claude");
  const ok = fakeRunner([]);
  await os("install", undefined, { root, from: fakeOsSource() }, ok);
  const failing: Runner = (cmd, args, cwd) => {
    if (cmd === process.execPath) throw new Error("vite exploded");
    ok(cmd, args, cwd);
  };
  await assert.rejects(os("build", undefined, { root }, failing), /vite exploded/);
  assert.deepEqual(readdirSync(join(root, "os", "versions")), ["1.0.0"]);
});

test("os start runs the active build in the background and os stop ends it", async () => {
  const root = await freshEnv("claude");
  await os("install", undefined, { root, from: fakeOsSource() }, fakeRunner([]));
  const started = await os("start", undefined, { root, port: "4799" });
  const pid = Number(/pid (\d+)/.exec(started)![1]);
  assert.match(started, /agent-os 1\.0\.0 started .*localhost:4799/);
  assert.doesNotThrow(() => process.kill(pid, 0));
  await assert.rejects(os("start", undefined, { root }), /already running/);
  assert.match(await os("status", undefined, { root }), /Running \(pid/);
  assert.equal(await os("stop", undefined, { root, preview: true }), "agent-os was not running.", "--preview leaves the app alone");
  assert.doesNotThrow(() => process.kill(pid, 0));
  assert.equal(await os("stop", undefined, { root }), "Stopped: app.");
  for (let i = 0; i < 50 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(!isAlive(pid), "the process is gone");
  assert.equal(await os("stop", undefined, { root }), "agent-os was not running.");
});

test("init --os yes installs agent-os; the default leaves it for later", async () => {
  const later = await freshEnv("claude");
  assert.ok(!existsSync(join(later, "os", "runtime")));
  const root = join(tempDir(), "env");
  const out = await init({ root, yes: true, tools: "claude", name: "T", email: "t@example.com", language: "en", os: "yes", from: fakeOsSource() }, fakeRunner([]));
  assert.match(out, /agent-os installed .* built as 1\.0\.0/);
  await assert.rejects(init({ root: join(tempDir(), "env"), yes: true, os: "maybe" }), /yes or no/);
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("a pid file whose pid now belongs to another program is not trusted (nor signaled)", async () => {
  const root = await freshEnv("claude");
  mkdirSync(join(root, ".state", "os"), { recursive: true });
  writeFileSync(join(root, ".state", "os", "app.pid"), String(process.pid)); // this test runner: alive, not agent-os
  assert.match(await os("status", undefined, { root }), /^agent-os is not installed/);
  assert.ok(!existsSync(join(root, ".state", "os", "app.pid")), "the stale pid file is cleaned up");
  writeFileSync(join(root, ".state", "os", "app.pid"), String(process.pid));
  assert.equal(await os("stop", undefined, { root }), "agent-os was not running.");
});

test("an interrupted npm install is redone, and a failed install can be resumed", async () => {
  const root = await freshEnv("claude");
  const calls: string[][] = [];
  const ok = fakeRunner(calls);
  let failBuild = true;
  const flaky: Runner = (cmd, args, cwd) => {
    if (cmd === process.execPath && failBuild) throw new Error("vite exploded");
    ok(cmd, args, cwd);
  };
  await assert.rejects(os("install", undefined, { root, from: fakeOsSource() }, flaky), /vite exploded/);
  assert.match(await os("status", undefined, { root }), /no build yet: `nexo os build`/);
  // npm got as far as node_modules but never finished: remove the marker to simulate it.
  const runtime = join(root, "os", "runtime", readdirSync(join(root, "os", "runtime"))[0]!);
  rmSync(join(runtime, ".ready"));
  failBuild = false;
  assert.match(await os("install", undefined, { root }, flaky), /resumed .* built as 1\.0\.0/);
  assert.equal(calls.filter((c) => c[0] === "npm").length, 2, "npm ran again for the unfinished runtime");
  assert.ok(existsSync(join(runtime, ".ready")));
});

test("build notes may start with a dash", async () => {
  const root = await freshEnv("claude");
  const run = fakeRunner([]);
  await os("install", undefined, { root, from: fakeOsSource() }, run);
  await os("build", undefined, { root, notes: "-fix the sidebar" }, run);
  assert.equal(json(join(root, "os", "versions", "1.0.1", "build.json")).notes, "-fix the sidebar");
});

test("os start fails loudly with the log when the server does not come up", async () => {
  const root = await freshEnv("claude");
  const src = fakeOsSource();
  await os("install", undefined, { root, from: src }, fakeRunner([]));
  writeFileSync(join(root, "os", "versions", "1.0.0", "host", "server", "main.ts"), 'console.error("boom: port taken"); process.exit(1);\n');
  await assert.rejects(os("start", undefined, { root, port: "4798" }), /exited on port 4798[\s\S]*boom: port taken/);
  assert.match(await os("status", undefined, { root }), /^agent-os 1\.0\.0/);
  assert.doesNotMatch(await os("status", undefined, { root }), /Running/);
});

test("os check runs the source's module checker and fails with its findings", async () => {
  const root = await freshEnv("claude");
  const src = fakeOsSource();
  await os("install", undefined, { root, from: src }, fakeRunner([]));
  const script = join(root, "os", "source", "scripts", "check-modules.ts");
  writeFileSync(script, 'console.log("Modules follow the rules (docs/module-rules.md).");\n');
  assert.match(await os("check", undefined, { root }), /follow the rules/);
  writeFileSync(script, 'console.log(`M3 modules/x/web/x.css:1 — hardcoded color ${process.argv.slice(2).join(" ")}`); process.exit(1);\n');
  await assert.rejects(os("check", undefined, { root, module: "x" }), /M3 modules\/x\/web\/x\.css:1 — hardcoded color --module=x/);
});
