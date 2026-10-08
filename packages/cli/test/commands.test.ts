import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { init } from "../src/commands/init.ts";
import { update } from "../src/commands/update.ts";
import { diagnose, staleAnalysis } from "../src/commands/doctor.ts";
import { analyze } from "../src/commands/analyze.ts";
import { clone, create } from "../src/commands/project.ts";
import { connect } from "../src/commands/connect.ts";
import { os, osDeps } from "../src/commands/os.ts";
import { readConfig } from "../src/core/config.ts";
import { copySource, runtimeHash, type Runner } from "../src/core/osruntime.ts";
import { generateAdapters } from "../src/core/adapters.ts";
import { linksTo } from "../src/core/fsx.ts";
import { loadPermissions } from "../src/core/permissions.ts";

// Windows git converts LF to CRLF on commit when core.autocrlf=true; tests assert on exact bytes.
process.env.GIT_CONFIG_PARAMETERS = "'core.autocrlf=false' 'core.eol=lf'";

// No test writes a real shortcut on a Windows desktop; the one that checks the message passes its own fake.
osDeps.createDesktopShortcut = () => null;

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** A port the OS can assign right now, so tests never collide with a real agent-os-nexo. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

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
  assert.ok(linksTo(join(root, ".claude/skills"), "../library/skills"));
  const linked = lstatSync(join(root, ".claude/skills")).ino;
  generateAdapters(root, readConfig(root), root, loadPermissions(join(root, "library/permissions.json")));
  assert.equal(lstatSync(join(root, ".claude/skills")).ino, linked, "a link that is already right is left alone");
  assert.ok(existsSync(join(root, ".claude/skills/nexo-dev/SKILL.md")));
  const planner = readFileSync(join(root, ".claude/agents/planner.md"), "utf8");
  assert.match(planner, /^---\nname: planner\n/);
  assert.match(planner, /\ntools: Read, Grep, Glob\n/);
  assert.match(planner, /\nmodel: sonnet\n/);
  assert.doesNotMatch(planner, /owner:/);
  create("shop", { root });
  assert.ok(linksTo(join(root, "projects/shop/.claude/skills"), "../../../library/skills"));
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

test("doctor: a fresh environment only asks for an OS analysis, and says what Gemini cannot enforce", async () => {
  const root = await freshEnv();
  const findings = diagnose(root);
  assert.deepEqual(findings.map((f) => f.area), ["gemini", "analysis"]);
  assert.ok(findings.every((f) => f.level === "warn"));
  assert.match(findings[0]!.message, /^not enforced by gemini: command deny rules/);
  assert.deepEqual(diagnose(await freshEnv("claude")).map((f) => f.area), ["analysis"], "Claude enforces every rule");
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
  assert.deepEqual(diagnose(root).filter((f) => f.area !== "gemini"), [], "only Gemini's known gaps remain");
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
  for (const v of ["1.0.0", "1.0.9"]) mkdirSync(join(root, "os/versions", v), { recursive: true });
  assert.equal(await os("next", undefined, { root }), "1.1.0");
  assert.equal(await os("versions", undefined, { root }), "  1.0.0\n* 1.0.9");
  await os("use", "1.0.0", { root });
  assert.equal(await os("versions", undefined, { root }), "* 1.0.0\n  1.0.9");
  await os("use", "latest", { root });
  assert.equal(await os("versions", undefined, { root }), "  1.0.0\n* 1.0.9");
  await assert.rejects(os("use", "3.0.0", { root }), /No build/);
});

// ── agent-os-nexo lifecycle: a fake source and a fake runner (no network, no real npm) ────────────────────────────────

// A server that answers like agent-os-nexo (200 + X-Agent-OS-Nexo on /api/os/info), so start/stop can be tested for real.
const FAKE_MAIN = `import http from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http.createServer((_q, s) => { s.setHeader("X-Agent-OS-Nexo", "1"); s.end("{}"); }).listen(port, "127.0.0.1");
`;

function fakeOsSource(deps: Record<string, string> = { express: "^5" }): string {
  const src = join(tempDir(), "agent-os-nexo");
  mkdirSync(join(src, "modules", "shell"), { recursive: true });
  mkdirSync(join(src, "scripts"), { recursive: true });
  mkdirSync(join(src, "host", "server"), { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "@nexodigital/agent-os-nexo", dependencies: deps }));
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

test("copySource leaves dependencies, builds and git out, and refuses what isn't agent-os-nexo", () => {
  const src = fakeOsSource();
  const dst = join(tempDir(), "copy");
  copySource(src, dst);
  assert.ok(existsSync(join(dst, "modules", "shell")));
  for (const junk of ["node_modules", "dist", ".git"]) assert.ok(!existsSync(join(dst, junk)), junk);
  assert.throws(() => copySource(tempDir(), join(tempDir(), "x")), /not an agent-os-nexo source/);
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
    assert.ok(linksTo(join(osDir, dir, "node_modules"), join(osDir, "runtime", runtimes[0]!, "node_modules")));
  }
  await assert.rejects(os("install", undefined, { root }, run), /already installed/);

  // A second build reuses the runtime: npm install ran once.
  assert.match(await os("build", undefined, { root, notes: "tweak" }, run), /Built 1\.0\.1/);
  assert.equal(calls.filter((c) => c[0] === "npm").length, 1);
  assert.ok(!existsSync(join(osDir, "versions", "1.0.1.building")));
  assert.match(await os("status", undefined, { root }), /agent-os-nexo 1\.0\.1 \(of 2 build/);
});

test("os install names the desktop shortcut when it made one (Windows)", async () => {
  const root = await freshEnv();
  const seen: string[] = [];
  osDeps.createDesktopShortcut = (repo) => (seen.push(repo), "C:\\Users\\me\\Desktop\\agent-os-nexo.lnk");
  try {
    const out = await os("install", undefined, { root, from: fakeOsSource() }, fakeRunner([]));
    assert.match(out, /Desktop shortcut created: C:\\Users\\me\\Desktop\\agent-os-nexo\.lnk$/);
    assert.ok(existsSync(join(seen[0]!, "packages", "cli")), "it looks in this repository");
  } finally {
    osDeps.createDesktopShortcut = () => null;
  }
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
  const port = String(await freePort());
  const started = await os("start", undefined, { root, port });
  const pid = Number(/pid (\d+)/.exec(started)![1]);
  assert.match(started, new RegExp(`agent-os-nexo 1\\.0\\.0 started .*localhost:${port}`));
  assert.doesNotThrow(() => process.kill(pid, 0));
  await assert.rejects(os("start", undefined, { root }), /already running/);
  assert.match(await os("status", undefined, { root }), /Running \(pid/);
  assert.equal(await os("stop", undefined, { root, preview: true }), "agent-os-nexo was not running.", "--preview leaves the app alone");
  assert.doesNotThrow(() => process.kill(pid, 0));
  assert.equal(await os("stop", undefined, { root }), "Stopped: app.");
  for (let i = 0; i < 50 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(!isAlive(pid), "the process is gone");
  assert.equal(await os("stop", undefined, { root }), "agent-os-nexo was not running.");
});

test("os start still recognizes a pre-rename build, which stamps only X-Agent-OS", async () => {
  const root = await freshEnv("claude");
  await os("install", undefined, { root, from: fakeOsSource() }, fakeRunner([]));
  writeFileSync(join(root, "os", "versions", "1.0.0", "host", "server", "main.ts"), FAKE_MAIN.replace("X-Agent-OS-Nexo", "X-Agent-OS"));
  const port = String(await freePort());
  try {
    assert.match(await os("start", undefined, { root, port }), /agent-os-nexo 1\.0\.0 started/);
  } finally {
    await os("stop", undefined, { root });
  }
});

test("os start tells the server its pid file and log, so a restart it does itself stays stoppable", async () => {
  const root = await freshEnv("claude");
  await os("install", undefined, { root, from: fakeOsSource() }, fakeRunner([]));
  const seen = join(root, "seen.json");
  writeFileSync(join(root, "os", "versions", "1.0.0", "host", "server", "main.ts"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(seen)}, JSON.stringify({ pid: process.env.NEXO_PID_FILE, log: process.env.NEXO_LOG_FILE }));\n${FAKE_MAIN}`);
  const port = String(await freePort());
  try {
    await os("start", undefined, { root, port });
    const env = JSON.parse(readFileSync(seen, "utf8")) as { pid: string; log: string };
    assert.equal(env.pid, join(root, ".state", "os", "app.pid"));
    assert.equal(env.log, join(root, ".state", "os", "app.log"));
  } finally {
    await os("stop", undefined, { root });
  }
});

test("init --os yes installs agent-os-nexo; the default leaves it for later", async () => {
  const later = await freshEnv("claude");
  assert.ok(!existsSync(join(later, "os", "runtime")));
  const root = join(tempDir(), "env");
  const out = await init({ root, yes: true, tools: "claude", name: "T", email: "t@example.com", language: "en", os: "yes", from: fakeOsSource() }, fakeRunner([]));
  assert.match(out, /agent-os-nexo installed .* built as 1\.0\.0/);
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
  writeFileSync(join(root, ".state", "os", "app.pid"), String(process.pid)); // this test runner: alive, not agent-os-nexo
  assert.match(await os("status", undefined, { root }), /^agent-os-nexo is not installed/);
  assert.ok(!existsSync(join(root, ".state", "os", "app.pid")), "the stale pid file is cleaned up");
  writeFileSync(join(root, ".state", "os", "app.pid"), String(process.pid));
  assert.equal(await os("stop", undefined, { root }), "agent-os-nexo was not running.");
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
  assert.match(await os("status", undefined, { root }), /^agent-os-nexo 1\.0\.0/);
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

test("os open opens the running app with its access link", async () => {
  const root = await freshEnv("claude");
  await os("install", undefined, { root, from: fakeOsSource() }, fakeRunner([]));
  await assert.rejects(os("open", undefined, { root }, fakeRunner([])), /not running/);
  const port = String(await freePort());
  await os("start", undefined, { root, port });
  try {
    writeFileSync(join(root, ".state", "os", `token-${port}`), "abc123\n"); // what the real server writes at startup
    const calls: string[][] = [];
    const out = await os("open", undefined, { root }, (cmd, args) => void calls.push([cmd, ...args]));
    assert.match(out, new RegExp(`^Opened http://localhost:${port}/\\?token=…$`), "the token is not printed back");
    assert.ok(calls[0]!.at(-1) === `http://localhost:${port}/?token=abc123`, JSON.stringify(calls));
  } finally {
    await os("stop", undefined, { root });
  }
});

// ── updates: a new release merged into the user's version ────────────────────────────────────────────────────

function release(version: string, files: Record<string, string>): string {
  const src = fakeOsSource();
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "@nexodigital/agent-os-nexo", version, dependencies: { express: "^5" } }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(src, rel, ".."), { recursive: true });
    writeFileSync(join(src, rel), text);
  }
  return src;
}
const gitOut = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

test("install starts the history and every build is a commit with its tag", async () => {
  const root = await freshEnv("claude");
  const run = fakeRunner([]);
  await os("install", undefined, { root, from: release("1.0.0", { "modules/shell/a.ts": "a1\n" }) }, run);
  const source = join(root, "os", "source");
  assert.equal(gitOut(source, "branch", "--show-current"), "main");
  assert.match(gitOut(source, "log", "--format=%s", "base"), /agent-os-nexo 1\.0\.0 \(Nexo release\)/);
  assert.equal(gitOut(source, "check-ignore", "node_modules"), "node_modules", "the runtime link is never committed");
  writeFileSync(join(source, "modules/shell/a.ts"), "a1 mine\n");
  await os("build", undefined, { root, notes: "my tweak" }, run);
  assert.match(gitOut(source, "log", "-1", "--format=%s"), /agent-os-nexo 1\.0\.1: my tweak/);
  assert.equal(gitOut(source, "tag", "--points-at", "HEAD"), "v1.0.1");
});

test("update merges a new release and keeps the user's changes", async () => {
  const root = await freshEnv("claude");
  const run = fakeRunner([]);
  await os("install", undefined, { root, from: release("1.0.0", { "modules/shell/a.ts": "a1\n", "modules/shell/b.ts": "b1\n" }) }, run);
  const source = join(root, "os", "source");
  writeFileSync(join(source, "modules/shell/b.ts"), "b1 mine\n"); // the user's change, not even built yet
  const out = await os("update", undefined, { root, from: release("1.1.0", { "modules/shell/a.ts": "a2\n", "modules/shell/b.ts": "b1\n", "modules/new/c.ts": "c\n" }) }, run);
  assert.match(out, /now has agent-os-nexo 1\.1\.0 \(was 1\.0\.0\), your changes kept/);
  assert.equal(readFileSync(join(source, "modules/shell/a.ts"), "utf8"), "a2\n", "Nexo's change arrives");
  assert.equal(readFileSync(join(source, "modules/shell/b.ts"), "utf8"), "b1 mine\n", "the user's change stays");
  assert.ok(existsSync(join(source, "modules/new/c.ts")), "new files arrive");
  assert.equal(gitOut(source, "status", "--porcelain"), "");
});

test("update stops on a real conflict; --continue needs it resolved, --abort undoes it", async () => {
  const root = await freshEnv("claude");
  const run = fakeRunner([]);
  await os("install", undefined, { root, from: release("1.0.0", { "modules/shell/a.ts": "line\n" }) }, run);
  const source = join(root, "os", "source");
  writeFileSync(join(source, "modules/shell/a.ts"), "line, mine\n");
  const v2 = release("1.1.0", { "modules/shell/a.ts": "line, Nexo's\n" });
  const out = await os("update", undefined, { root, from: v2 }, run);
  assert.match(out, /left conflicts in:\n {2}modules\/shell\/a\.ts/);
  await assert.rejects(os("update", undefined, { root, from: v2 }, run), /already waiting/);
  await assert.rejects(os("update", undefined, { root, continue: true }, run), /markers are still in: modules\/shell\/a\.ts/);
  await os("update", undefined, { root, abort: true }, run);
  assert.equal(readFileSync(join(source, "modules/shell/a.ts"), "utf8"), "line, mine\n", "abort restores the user's version");

  await os("update", undefined, { root, from: v2 }, run);
  writeFileSync(join(source, "modules/shell/a.ts"), "line, both\n"); // resolved
  assert.match(await os("update", undefined, { root, continue: true }, run), /Update finished/);
  assert.equal(gitOut(source, "status", "--porcelain"), "");
  assert.match(gitOut(source, "log", "-1", "--format=%s"), /Update to agent-os-nexo 1\.1\.0/);
});

test("nexo map indexes a project: overview, parts, routes, how they talk, symbols; and knows when it is stale", async () => {
  const root = await freshEnv("claude");
  const { map } = await import("../src/commands/map.ts");
  create("shop", { root });
  const code = join(root, "projects", "shop", "code");
  const put = (rel: string, text: string) => (mkdirSync(join(code, rel, ".."), { recursive: true }), writeFileSync(join(code, rel), text));
  put("package.json", JSON.stringify({ workspaces: ["apps/*"] }));
  put("apps/api/package.json", JSON.stringify({ name: "@shop/api", dependencies: { express: "^5" }, scripts: { dev: "node src/server.ts" } }));
  put("apps/api/src/server.ts", 'export class Server {}\nexport const port = Number(process.env.PORT);\napp.get("/api/users/:id", h);\nrouter.post("/api/orders", h);\n');
  put("apps/web/package.json", JSON.stringify({ name: "@shop/web", dependencies: { react: "^19", vite: "^8" } }));
  put("apps/web/src/App.tsx", 'import { money } from "@shop/api/money";\nexport function App() {}\nfetch(`${BASE}/api/users/${id}`);\naxios.post("/api/orders", body);\n');
  put("apps/web/src/App.test.tsx", 'fetch("/api/orders");\n');
  put("docker-compose.yml", "services:\n  db:\n    image: postgres:16\n    ports:\n      - 5432:5432\n  api:\n    build: .\n    depends_on:\n      - db\n    environment:\n      - DATABASE_URL=x\n");
  put("node_modules/dep/index.js", "function hidden() {}\n");
  const out = map("shop", { root });
  assert.match(out, /Indexed shop in context\/map\/: \d+ files, 2 part\(s\), 3 symbols in 2 file\(s\), 2 routes, 2 HTTP calls\./);
  const dir = join(root, "projects/shop/context/map");
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(readme, /### apps-api — `apps\/api\/`\n- package: `@shop\/api` \(package\.json\)\n- stack: Express/);
  assert.match(readme, /stack: React, Vite/);
  assert.match(readme, /reads env: PORT/);
  assert.match(readme, /\*\*apps-web\*\* imports \*\*apps-api\*\*/);
  assert.match(readme, /\*\*apps-web\*\* calls \*\*apps-api\*\* over HTTP: 2 call site\(s\)/, "the test file's call is not counted");
  assert.match(readme, /\*\*db\*\* \(docker-compose\.yml\) image `postgres:16` · ports 5432:5432/);
  assert.match(readme, /service \*\*api\*\* depends on \*\*db\*\*/);
  assert.match(readFileSync(join(dir, "routes.md"), "utf8"), /`GET \/api\/users\/:id` — apps\/api\/src\/server\.ts:3/);
  assert.match(readFileSync(join(dir, "symbols/apps-api.txt"), "utf8"), /apps\/api\/src\/server\.ts\n\s+1 class Server\n\s+2 const port/);
  assert.doesNotMatch(readFileSync(join(dir, "files.md"), "utf8"), /node_modules/);
  assert.equal(map("shop", { root, check: true }), "The code map is current.");
  const later = new Date(Date.now() + 5000);
  put("apps/web/src/New.tsx", "export function New() {}\n");
  (await import("node:fs")).utimesSync(join(code, "apps/web/src/New.tsx"), later, later);
  assert.match(map("shop", { root, check: true }), /older than the code/);
  assert.throws(() => map("nope", { root }), /Unknown project/);
});

test("nexo clone indexes the project right away, and doctor flags a project without an index", async () => {
  const root = await freshEnv("claude");
  const origin = join(tempDir(), "app");
  mkdirSync(origin);
  execFileSync("git", ["init", "-q", origin]);
  writeFileSync(join(origin, "main.py"), "def main():\n    pass\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", origin, "add", "-A"]);
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", origin, "commit", "-qm", "init"]);
  assert.match(clone(origin, { root, name: "pyapp" }), /Indexed pyapp in context\/map\//);
  assert.match(readFileSync(join(root, "projects/pyapp/context/map/symbols/code.txt"), "utf8"), /function main/);
  rmSync(join(root, "projects/pyapp/context/map"), { recursive: true });
  assert.ok(diagnose(root).some((f) => f.area === "projects/pyapp" && /no code index: run `nexo map pyapp`/.test(f.message)));
});
