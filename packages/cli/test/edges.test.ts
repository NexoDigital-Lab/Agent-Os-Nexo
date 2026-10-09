// The paths a normal run rarely takes: finding the root, prompts, unreadable files, the doctor's warnings, the binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { freshEnv, tempDir } from "./helpers.ts";
import { defaultRoot, expandHome, findRoot } from "../src/core/paths.ts";
import { createAsker } from "../src/core/prompt.ts";
import { ownerOf } from "../src/core/owner.ts";
import { buildLibraryIndex } from "../src/core/libindex.ts";
import { analyze, osName } from "../src/commands/analyze.ts";
import { connect } from "../src/commands/connect.ts";
import { diagnose, doctor } from "../src/commands/doctor.ts";
import { index } from "../src/commands/index.ts";

const BIN = join(import.meta.dirname, "..", "src", "bin.ts");

test("paths: ~ expands to home, the default root lives there", () => {
  assert.equal(expandHome("~"), homedir());
  assert.equal(expandHome("~/env"), join(homedir(), "env"));
  assert.equal(expandHome("/abs/~x"), "/abs/~x");
  assert.equal(defaultRoot(), join(homedir(), "environments"));
});

test("paths: findRoot takes --root, then NEXO_ROOT, then the nearest parent with the config", async () => {
  const root = await freshEnv();
  assert.equal(findRoot(root), root);
  assert.throws(() => findRoot(join(root, "nope")), /No Nexo environment at .*missing environment\.config\.json/);
  const deep = join(root, "projects", "a", "b");
  mkdirSync(deep, { recursive: true });
  const saved = process.env.NEXO_ROOT;
  try {
    delete process.env.NEXO_ROOT;
    assert.equal(findRoot(undefined, deep), root);
    assert.throws(() => findRoot(undefined, tempDir()), /Not inside a Nexo environment/);
    process.env.NEXO_ROOT = root;
    assert.equal(findRoot(undefined, tempDir()), root);
  } finally {
    if (saved === undefined) delete process.env.NEXO_ROOT;
    else process.env.NEXO_ROOT = saved;
  }
});

test("prompt: non-interactive answers with the default; a terminal asks and keeps the default on empty", async () => {
  const quiet = createAsker(true);
  assert.equal(await quiet.ask("Name?", "Ana"), "Ana");
  quiet.close();
  const notTty = createAsker(false, Object.assign(new PassThrough(), { isTTY: false }));
  assert.equal(await notTty.ask("Name?", "Ana"), "Ana");

  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = new PassThrough();
  let shown = "";
  output.on("data", (b: Buffer) => (shown += b.toString()));
  const asker = createAsker(false, input, output);
  const first = asker.ask("Name?", "Ana");
  input.write("  Bea  \n");
  assert.equal(await first, "Bea");
  const second = asker.ask("Email?", "a@b.c");
  input.write("\n");
  assert.equal(await second, "a@b.c");
  asker.close();
  assert.match(shown, /Name\? \[Ana\]: /);
});

test("owner: from frontmatter or JSON; null when missing, not a string, or unreadable", () => {
  const dir = tempDir();
  const md = join(dir, "a.md");
  writeFileSync(md, "---\nowner: nexo\n---\nx\n");
  assert.equal(ownerOf(md), "nexo");
  writeFileSync(join(dir, "b.json"), JSON.stringify({ owner: "user" }));
  assert.equal(ownerOf(join(dir, "b.json")), "user");
  writeFileSync(join(dir, "c.json"), JSON.stringify({ owner: 3 }));
  assert.equal(ownerOf(join(dir, "c.json")), null);
  writeFileSync(join(dir, "d.md"), "no frontmatter");
  assert.equal(ownerOf(join(dir, "d.md")), null);
  writeFileSync(join(dir, "e.json"), "{ broken");
  assert.equal(ownerOf(join(dir, "e.json")), null);
  assert.equal(ownerOf(join(dir, "missing.md")), null);
});

test("library index: fills in names, descriptions and owners that the files leave out", () => {
  const lib = tempDir();
  mkdirSync(join(lib, "skills", "bare"), { recursive: true });
  writeFileSync(join(lib, "skills", "bare", "SKILL.md"), "no frontmatter\n");
  mkdirSync(join(lib, "hooks"));
  writeFileSync(join(lib, "hooks", "h.json"), "{}");
  mkdirSync(join(lib, "memory"));
  writeFileSync(join(lib, "memory", "index.json"), JSON.stringify([{ a: 1 }, { b: 2 }]));
  buildLibraryIndex(lib);
  const out = JSON.parse(readFileSync(join(lib, "index.json"), "utf8"));
  assert.deepEqual(out.skills, [{ name: "bare", description: "", owner: "user", path: join("skills", "bare", "SKILL.md") }]);
  assert.deepEqual(out.hooks, [{ name: "h", description: "", owner: "user", path: join("hooks", "h.json") }]);
  assert.equal(out.memory.entries, 2);
});

test("analyze: the OS name is os-release's PRETTY_NAME on Linux, else the platform", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "pretty"), 'NAME="X"\nPRETTY_NAME="Fedora Linux 44"\n');
  writeFileSync(join(dir, "plain"), "NAME=X\n");
  assert.equal(osName("linux", join(dir, "pretty")), "Fedora Linux 44");
  assert.equal(osName("linux", join(dir, "plain")), "linux");
  assert.equal(osName("linux", join(dir, "missing")), "linux");
  assert.equal(osName("win32", join(dir, "pretty")), "win32");
});

test("analyze: a user's own command list, toolchains that fail or print no version, no shell variable", async () => {
  const root = await freshEnv("claude");
  writeFileSync(join(root, "library", "commands", "os-analysis.json"), JSON.stringify({
    toolchains: [
      { name: "empty", run: [] },
      { name: "node", run: [process.execPath, "--version"] },
      { name: "silent", run: [process.execPath, "-e", "console.log('no digits')"] },
      { name: "broken", run: ["nexo-no-such-tool", "--version"] },
    ],
    packageManagers: ["nexo-no-such-pm"],
  }));
  const saved = { SHELL: process.env.SHELL, ComSpec: process.env.ComSpec };
  try {
    delete process.env.SHELL;
    delete process.env.ComSpec;
    const out = analyze({ root, now: new Date("2026-10-06T00:00:00Z") });
    assert.match(out, /shell unknown · package manager none found/);
    assert.match(out, /^Toolchains: node \d+\.\d+\.\d+$/m);
    const config = JSON.parse(readFileSync(join(root, "environment.config.json"), "utf8"));
    assert.deepEqual(Object.keys(config.system.toolchains), ["node"]);
    writeFileSync(join(root, "library", "commands", "os-analysis.json"), JSON.stringify({ toolchains: [], packageManagers: [] }));
    assert.match(analyze({ root }), /^Toolchains: none found$/m);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

test("connect: lists what exists, and refuses bad input", async () => {
  const root = await freshEnv("claude");
  assert.match(connect(undefined, { root }), /No connections yet/);
  connect("tracker", { root, command: "npx", args: "-y,tracker-mcp", description: "Tasks" });
  assert.match(connect(undefined, { root }), /^tracker \(mcp\) → claude — Tasks$/m);
  assert.throws(() => connect("other", { root }), /Pass --command/);
  assert.throws(() => connect("other", { root, command: "x", env: ["NOVALUE"] }), /--env expects KEY=VALUE/);
});

test("doctor: reports what is broken and says nothing was changed", async () => {
  const root = await freshEnv("claude,gemini");
  const lib = join(root, "library");
  rmSync(join(root, ".claude", "CLAUDE.md"));
  rmSync(join(root, ".gemini", "settings.json"));
  writeFileSync(join(root, "AGENTS.md"), "x\n".repeat(130));
  rmSync(join(lib, "index.json"));
  mkdirSync(join(lib, "skills", "odd"));
  writeFileSync(join(lib, "skills", "odd", "SKILL.md"), `---\nname: other\ndescription: d\nowner: user\nversion: 1\n---\n${"l\n".repeat(210)}`);
  mkdirSync(join(lib, "skills", "empty"));
  writeFileSync(join(lib, "agents", "big.md"), "---\nname: big\ndescription: d\nowner: user\nmodel: opus\n---\nx\n");
  writeFileSync(join(lib, "hooks", "half.json"), JSON.stringify({ event: "pre-tool" }));
  writeFileSync(join(lib, "permissions.json"), JSON.stringify({ default: "maybe" }));
  mkdirSync(join(root, "projects", "nocode"));
  writeFileSync(join(root, "projects", "nocode", "AGENTS.md"), "# nocode\n");
  mkdirSync(join(root, "projects", "unmapped", "code"), { recursive: true });
  writeFileSync(join(root, "projects", "unmapped", "AGENTS.md"), "# unmapped\n");
  writeFileSync(join(root, "projects", "unmapped", "code", "a.ts"), "");
  mkdirSync(join(root, "projects", "unmapped", "context"), { recursive: true });
  writeFileSync(join(root, "projects", "unmapped", "context", "permissions.json"), JSON.stringify({ files: { read: { allow: "x" } } }));

  const areas = diagnose(root).map((f) => `${f.level} ${f.area}: ${f.message}`);
  for (const expected of [
    /^error claude: missing \.claude\/CLAUDE\.md/,
    /^error gemini: missing \.gemini\/settings\.json/,
    /^warn AGENTS\.md: 130 lines/,
    /^warn library: index\.json missing/,
    /^warn skill odd: name "other" differs/,
    /^warn skill odd: \d+ lines \(max 200\)/,
    /^error skill empty: missing /,
    /^warn agent big\.md: model "opus" is above the ceiling "sonnet"/,
    /^error hook half\.json: missing "match"/,
    /^error permissions\.json: /,
    /^warn projects\/nocode: no code\/ folder/,
    /^warn projects\/unmapped: no code index: run `nexo map unmapped`/,
    /^error projects\/unmapped\/context\/permissions\.json: /,
  ]) {
    assert.ok(areas.some((a) => expected.test(a)), `${expected} in:\n${areas.join("\n")}`);
  }
  const { output, failed } = doctor({ root });
  assert.ok(failed);
  assert.match(output, /\[ERROR\] claude: /);
  assert.match(output, /nothing was changed\.$/);
  assert.ok(JSON.parse(doctor({ root, json: true }).output).length >= 13);
  writeFileSync(join(root, "environment.config.json"), "{ broken");
  assert.match(diagnose(root)[0]!.message, /^unreadable: /);
});

test("doctor: a healthy environment looks good", async () => {
  const root = await freshEnv("claude");
  const config = JSON.parse(readFileSync(join(root, "environment.config.json"), "utf8"));
  config.system = { ...config.system, lastAnalysis: new Date().toISOString() };
  writeFileSync(join(root, "environment.config.json"), JSON.stringify(config));
  assert.deepEqual(doctor({ root }), { output: "Nexo environment looks good.", failed: false });
});

test("index: rebuilds library/index.json", async () => {
  const root = await freshEnv("claude");
  rmSync(join(root, "library", "index.json"));
  assert.equal(index({ root }), "library/index.json rebuilt.");
  assert.ok(JSON.parse(readFileSync(join(root, "library", "index.json"), "utf8")).skills.length > 0);
});

/** Runs the real binary from source. */
const nexo = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, NEXO_ROOT: "", ...env } });

test("bin: help, version, errors and every command reach their handlers", async () => {
  assert.match(nexo([]).stdout, /^nexo — install and maintain/);
  assert.match(nexo(["--help"]).stdout, /Usage: nexo <command>/);
  assert.match(nexo(["--version"]).stdout, /^\d+\.\d+\.\d+/);
  const unknown = nexo(["frobnicate"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /nexo: Unknown command "frobnicate"/);
  assert.match(nexo(["clone"]).stderr, /Usage: nexo clone/);
  assert.match(nexo(["new"]).stderr, /Usage: nexo new/);

  const dir = tempDir();
  const root = join(dir, "env");
  const init = nexo(["init", root, "--yes", "--tools", "claude", "--name", "T", "--email", "t@example.com", "--language", "en", "--os", "no", "--memory", "none"]);
  assert.equal(init.status, 0, init.stderr);
  const env = { NEXO_ROOT: root };
  assert.equal(nexo(["update"], env).status, 0);
  assert.equal(nexo(["index"], env).stdout.trim(), "library/index.json rebuilt.");
  assert.equal(nexo(["analyze"], env).status, 0);
  const doctorRun = nexo(["doctor", "--quick"], env);
  assert.equal(doctorRun.status, 0, doctorRun.stdout);
  rmSync(join(root, ".claude", "CLAUDE.md"));
  assert.equal(nexo(["doctor", "--quick"], env).status, 1, "an error makes doctor fail");
  assert.match(nexo(["new", "shop"], env).stdout, /shop/);
  assert.match(nexo(["connect"], env).stdout, /No connections yet/);
  assert.equal(nexo(["map", "shop"], env).status, 0);
  assert.match(nexo(["os"], env).stdout, /not installed/);
  const clone = nexo(["clone", join(dir, "no-such-repo")], env);
  assert.equal(clone.status, 1);
  execFileSync("git", ["--version"]); // clone's failure above is git's, not a missing git
});
