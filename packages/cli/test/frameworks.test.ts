// Third-party frameworks: sources, detection, wiring next to Nexo's own files, approval of hooks, doctor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { framework } from "../src/commands/framework.ts";
import { diagnose } from "../src/commands/doctor.ts";
import { create } from "../src/commands/project.ts";
import { materializePlugin, pluginDir } from "../src/core/frameworkplugin.ts";
import { defaultFramework, detectContributions, kindOf, loadFrameworks, parseSource, projectIdOf, type Run } from "../src/core/frameworks.ts";
import { readConfig } from "../src/core/config.ts";
import { readJson, writeJson, writeText } from "../src/core/fsx.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** A Claude Code plugin layout under `dir`. */
function plugin(dir: string, opts: { skill?: string; agent?: string } = {}): void {
  const skill = opts.skill ?? "review";
  writeText(join(dir, "package.json"), JSON.stringify({ name: "corp-agents", version: "2.3.4", license: "MIT" }));
  writeText(join(dir, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: d\n---\nbody`);
  writeText(join(dir, "agents", "reviewer.md"), `---\nname: ${opts.agent ?? "reviewer"}\ndescription: Reviews\ntools: Read\n---\nReview things.`);
  writeText(join(dir, "commands", "ship.md"), "---\ndescription: Ship\n---\nShip it.");
  writeText(join(dir, "hooks", "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/guard.js" }] }] } }));
  writeText(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { corpdb: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/mcp.js"], env: { A: "1" } }, remote: { url: "https://x" } } }));
  writeText(join(dir, "CLAUDE.md"), "Corp rules.");
}

/** A fake npm: records the call and "installs" the plugin into <prefix>/node_modules/<pkg>. */
function fakeNpm(calls: string[][] = []): Run {
  return (cmd, args, cwd) => {
    calls.push([cmd, ...args]);
    const spec = args[args.length - 1]!;
    const pkg = spec.slice(0, spec.lastIndexOf("@"));
    plugin(join(cwd, "node_modules", ...pkg.split("/")));
  };
}

/** Makes a framework the environment's default method (enabled first), so the terminal AIs' files carry it. */
function useAsDefault(root: string, name: string): void {
  framework("enable", [name], { root });
  framework("default", [name], { root });
}

test("parseSource: exact npm versions only, path sources, unknown kinds", () => {
  assert.deepEqual(parseSource("npm:@corp/agents@1.2.3"), { kind: "npm", pkg: "@corp/agents", version: "1.2.3" });
  assert.deepEqual(parseSource("npm:x@1.0.0-beta.1"), { kind: "npm", pkg: "x", version: "1.0.0-beta.1" });
  for (const bad of ["npm:x", "npm:x@latest", "npm:x@^1.2.3", "npm:x@1", "npm:x@>=1.0.0", "npm:@@bad@1.0.0"]) assert.throws(() => parseSource(bad), /exact version|valid npm/);
  assert.equal(parseSource("path:/opt/fw").kind, "path");
  assert.throws(() => parseSource("github:a/b@v1"), /Unknown source/);
});

test("add npm: pinned install without scripts, detection, manifest; hooks stay off", async () => {
  const root = await freshEnv("claude,opencode,codex");
  const calls: string[][] = [];
  const out = framework("add", ["npm:corp-agents@2.3.4"], { root }, fakeNpm(calls));
  const dir = join(root, "frameworks", "corp-agents");
  assert.deepEqual(calls[0], ["npm", "install", "--prefix", dir, "--ignore-scripts", "--no-audit", "--no-fund", "corp-agents@2.3.4"]);
  assert.match(out, /Added framework corp-agents 2\.3\.4/);
  assert.match(out, /1 hooks .* stay off/);
  const m = json(join(dir, "framework.json"));
  assert.equal(m.managed, "nexo");
  assert.equal(m.license, "MIT");
  assert.equal(m.hooksApproved, false);
  assert.equal(m.enabled, false, "add never activates");
  assert.equal(m.kind, "method");
  assert.deepEqual(m.contributes.skills, ["skills/review"]);
  assert.deepEqual(m.contributes.agents, ["agents/reviewer.md"]);
  assert.deepEqual(m.contributes.instructions, ["CLAUDE.md"]);

  // nothing is wired until it is enabled and made the default
  assert.deepEqual(Object.keys(json(join(root, ".mcp.json")).mcpServers), []);
  assert.ok(!existsSync(join(root, ".claude", "agents", "reviewer.md")));
  framework("enable", ["corp-agents"], { root });
  assert.ok(!existsSync(join(root, ".claude", "agents", "reviewer.md")), "available to pick is not wired in terminals");
  framework("default", ["corp-agents"], { root });
  // MCP: local servers reach every AI, remote ones are not wired
  const mcp = json(join(root, ".mcp.json")).mcpServers;
  assert.deepEqual(Object.keys(mcp), ["corpdb"]);
  assert.deepEqual(mcp.corpdb.args, [join(dir, "node_modules", "corp-agents").replace(/\\/g, "/") + "/mcp.js"]);
  assert.ok(json(join(root, "opencode.json")).mcp.corpdb);
  assert.match(readFileSync(join(root, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.corpdb\]/);
  // agents and commands carry a marker; instructions follow Nexo's pointer; no hooks yet
  const agent = readFileSync(join(root, ".claude", "agents", "reviewer.md"), "utf8");
  assert.match(agent, /^---\nname: reviewer[\s\S]*---\n<!-- Generated by nexo from framework corp-agents/);
  assert.match(readFileSync(join(root, ".claude", "commands", "ship.md"), "utf8"), /from framework corp-agents/);
  const md = readFileSync(join(root, ".claude", "CLAUDE.md"), "utf8").split("\n");
  assert.equal(md[0], "@../AGENTS.md");
  assert.equal(md[1], "<!-- third-party framework: corp-agents -->");
  assert.match(md[2]!, /^@\.\.\/frameworks\/corp-agents\/node_modules\/corp-agents\/CLAUDE\.md$/);
  assert.equal(json(join(root, ".claude", "settings.json")).hooks.PreToolUse?.some((h: any) => JSON.stringify(h).includes("guard.js")) ?? false, false);
  // skills: the link now goes through a generated folder holding library and framework skills; library/skills is untouched
  const skills = join(root, ".claude", "skills");
  assert.ok(lstatSync(skills).isSymbolicLink());
  assert.ok(existsSync(join(skills, "review", "SKILL.md")));
  assert.ok(readdirSync(join(skills)).length > 1, "library skills are still there");
  assert.ok(!existsSync(join(root, "library", "skills", "review")));
  assert.ok(existsSync(join(root, ".opencode", "skills", "review", "SKILL.md")));

  // approve hooks, then withdraw them
  framework("enable", ["corp-agents"], { root, hooks: true });
  assert.match(JSON.stringify(json(join(root, ".claude", "settings.json")).hooks.PreToolUse), /guard\.js/);
  assert.match(JSON.stringify(json(join(root, ".claude", "settings.json")).hooks.PreToolUse), /frameworks\/corp-agents\/node_modules\/corp-agents\/guard\.js/);
  framework("disable", ["corp-agents"], { root, hooks: true });
  assert.doesNotMatch(JSON.stringify(json(join(root, ".claude", "settings.json")).hooks), /guard\.js/);

  // disable: it stops being the default and its contributions vanish; the skills link goes back to the library
  framework("disable", ["corp-agents"], { root });
  assert.equal(defaultFramework(readConfig(root)), "nexo");
  assert.deepEqual(Object.keys(json(join(root, ".mcp.json")).mcpServers), []);
  assert.ok(!existsSync(join(root, ".claude", "agents", "reviewer.md")));
  assert.ok(!existsSync(join(root, ".claude", "commands", "ship.md")));
  assert.doesNotMatch(readFileSync(join(root, ".claude", "CLAUDE.md"), "utf8"), /corp-agents/);
  assert.equal(realpathSync(skills), realpathSync(join(root, "library", "skills")));
});

test("add npm: a failed install leaves nothing behind; duplicates and bad input are refused", async () => {
  const root = await freshEnv("claude");
  const failing: Run = () => {
    throw new Error("npm exploded");
  };
  assert.throws(() => framework("add", ["npm:corp@1.0.0"], { root }, failing), /npm exploded/);
  assert.ok(!existsSync(join(root, "frameworks", "corp")));
  const noop: Run = () => {};
  assert.throws(() => framework("add", ["npm:corp@1.0.0"], { root }, noop), /did not produce/);
  assert.ok(!existsSync(join(root, "frameworks", "corp")));
  assert.throws(() => framework("add", ["npm:corp@latest"], { root }, fakeNpm()), /exact version/);
  assert.throws(() => framework("add", ["npm:corp@1.0.0", "--x"], { root, name: "Bad Name" }, fakeNpm()), /Invalid framework name/);
  framework("add", ["npm:@corp/tools@1.0.0"], { root }, fakeNpm());
  assert.ok(existsSync(join(root, "frameworks", "tools", "framework.json")), "scope dropped from the default name");
  assert.throws(() => framework("add", ["npm:@corp/tools@1.0.0"], { root }, fakeNpm()), /already exists/);
  assert.throws(() => framework("add", [], { root }), /Usage/);
  assert.throws(() => framework("enable", ["nope"], { root }), /No framework "nope"/);
  assert.throws(() => framework("bogus", [], { root }), /Usage/);
});

test("add path: referenced and never modified; remove only forgets it", async () => {
  const root = await freshEnv("claude");
  const ext = join(tempDir(), "company-fw");
  plugin(ext);
  const before = readdirSync(ext).sort();
  const out = framework("add", [`path:${ext}`], { root }, () => assert.fail("no process for path sources"));
  assert.match(out, /Added framework company-fw 2\.3\.4 method \[external\]/);
  const m = json(join(root, "frameworks", "company-fw", "framework.json"));
  assert.equal(m.managed, "external");
  assert.equal(m.root, ext);
  assert.deepEqual(readdirSync(ext).sort(), before, "the referenced folder is untouched");
  useAsDefault(root, "company-fw");
  assert.ok(existsSync(join(root, ".claude", "agents", "reviewer.md")));
  assert.match(framework("list", [], { root }), /company-fw 2\.3\.4 method \[external\] path:.*available, the default method; 1 skills, 1 agents, 1 commands, 2 MCP servers, 1 instruction files; 1 hooks \(not approved\)/);
  assert.match(framework(undefined, [], { root }), /company-fw/);
  assert.match(framework("remove", ["company-fw"], { root }), /was not touched/);
  assert.deepEqual(readdirSync(ext).sort(), before);
  assert.ok(!existsSync(join(root, "frameworks", "company-fw")));
  assert.ok(!existsSync(join(root, ".claude", "agents", "reviewer.md")));
  assert.equal(defaultFramework(readConfig(root)), "nexo", "removing the default method resets it");
  assert.match(framework("list", [], { root }), /No frameworks yet/);
  assert.throws(() => framework("add", [`path:${join(ext, "missing")}`], { root }), /not a folder/);
  assert.ok(!existsSync(join(root, "frameworks", "missing")));
});

test("default: only an enabled method; tools are wired when enabled; remove npm deletes its folder", async () => {
  const root = await freshEnv("claude");
  create("shop", { root });
  framework("add", ["npm:corp-agents@2.3.4"], { root }, fakeNpm());
  assert.throws(() => framework("default", ["corp-agents"], { root }), /Enable "corp-agents" first/);
  assert.throws(() => framework("default", ["ghost"], { root }), /No framework "ghost"/);
  assert.match(framework("default", [], { root }), /is nexo/);
  useAsDefault(root, "corp-agents");
  assert.equal(readConfig(root).framework, "corp-agents");
  // the default applies to the root and to every project alike
  assert.ok(existsSync(join(root, ".claude", "agents", "reviewer.md")));
  assert.ok(existsSync(join(root, "projects", "shop", ".claude", "agents", "reviewer.md")));
  assert.match(framework("default", ["nexo"], { root }), /Nexo's own/);
  assert.equal(readConfig(root).framework, undefined);
  assert.ok(!existsSync(join(root, "projects", "shop", ".claude", "agents", "reviewer.md")));
  assert.match(framework("remove", ["corp-agents"], { root }), /Removed framework/);
  assert.ok(!existsSync(join(root, "frameworks", "corp-agents")));
  const config = readConfig(root);
  assert.equal(projectIdOf(root, config, root), null);
  assert.equal(projectIdOf(root, config, join(root, "projects", "shop")), "shop");

  // a tool (only MCP servers) is never picked: it is wired as soon as it is enabled
  const ext = join(tempDir(), "dbtool");
  writeText(join(ext, ".mcp.json"), JSON.stringify({ mcpServers: { dbx: { command: "node", args: ["x.js"] } } }));
  framework("add", [`path:${ext}`], { root });
  assert.match(framework("list", [], { root }), /dbtool unknown tool \[external\]/);
  assert.deepEqual(Object.keys(json(join(root, ".mcp.json")).mcpServers), []);
  framework("enable", ["dbtool"], { root });
  assert.deepEqual(Object.keys(json(join(root, ".mcp.json")).mcpServers), ["dbx"]);
  assert.throws(() => framework("default", ["dbtool"], { root }), /is a tool/);
  assert.throws(() => framework("plugin", ["nope"], { root }), /No framework "nope"/);
});

test("kind: detected from what it contributes, or declared by its framework.json", () => {
  const empty = { skills: [], agents: [], commands: [], hooks: {}, mcpServers: {}, instructions: [] };
  assert.equal(kindOf({ ...empty, mcpServers: { a: {} } }), "tool");
  assert.equal(kindOf({ ...empty }), "tool");
  for (const k of ["skills", "agents", "commands", "instructions"] as const) assert.equal(kindOf({ ...empty, [k]: ["x"] }), "method");
  assert.equal(kindOf({ ...empty, skills: ["s"] }, "tool"), "tool");
  assert.equal(kindOf({ ...empty, mcpServers: { a: {} } }, "method"), "method");
  assert.equal(kindOf({ ...empty, skills: ["s"] }, "bogus"), "method");
  const ext = join(tempDir(), "declared");
  writeText(join(ext, "framework.json"), JSON.stringify({ kind: "tool", contributes: { skills: ["skills/a"] } }));
});

test("kind: a framework.json that declares one wins over detection", async () => {
  const root = await freshEnv("claude");
  const ext = join(tempDir(), "declared");
  writeText(join(ext, "skills", "a", "SKILL.md"), "---\nname: a\n---\n");
  writeText(join(ext, "framework.json"), JSON.stringify({ kind: "tool", contributes: { skills: ["skills/a"] } }));
  framework("add", [`path:${ext}`], { root });
  assert.equal(JSON.parse(framework("list", [], { root, json: true })).frameworks[0].kind, "tool");
});

test("list --json describes frameworks for agent-os; plugin materializes a Claude Code plugin folder", async () => {
  const root = await freshEnv("claude");
  framework("add", ["npm:corp-agents@2.3.4"], { root }, fakeNpm());
  const read = () => JSON.parse(framework("list", [], { root, json: true }));
  const first = read();
  assert.equal(first.default, "nexo");
  assert.deepEqual(first.broken, []);
  const e = first.frameworks[0];
  assert.deepEqual(
    { name: e.name, kind: e.kind, source: e.source, version: e.version, license: e.license, managed: e.managed, enabled: e.enabled, hooksApproved: e.hooksApproved, isDefault: e.isDefault },
    { name: "corp-agents", kind: "method", source: "npm:corp-agents@2.3.4", version: "2.3.4", license: "MIT", managed: "nexo", enabled: false, hooksApproved: false, isDefault: false },
  );
  assert.deepEqual(e.hookCommands, ["node ${CLAUDE_PLUGIN_ROOT}/guard.js"]);
  assert.deepEqual(e.contributions, { skills: ["skills/review"], agents: ["agents/reviewer.md"], commands: ["commands/ship.md"], mcpServers: ["corpdb", "remote"], instructions: ["CLAUDE.md"], hooks: 1 });

  assert.throws(() => framework("plugin", ["corp-agents"], { root }), /not enabled/);
  framework("enable", ["corp-agents"], { root });
  const dir = framework("plugin", ["corp-agents"], { root });
  assert.equal(dir, join(root, ".state", "nexo", "plugins", "corp-agents"));
  const content = join(root, "frameworks", "corp-agents", "node_modules", "corp-agents");
  assert.deepEqual(json(join(dir, ".claude-plugin", "plugin.json")).name, "corp-agents");
  assert.equal(json(join(dir, ".claude-plugin", "plugin.json")).version, "2.3.4");
  assert.ok(existsSync(join(dir, "skills", "review", "SKILL.md")));
  assert.match(readFileSync(join(dir, "agents", "reviewer.md"), "utf8"), /Review things/);
  assert.ok(existsSync(join(dir, "commands", "ship.md")));
  assert.ok(!existsSync(join(dir, "hooks")), "hooks only once approved");
  const mcp = json(join(dir, ".mcp.json")).mcpServers;
  assert.deepEqual(Object.keys(mcp), ["corpdb"], "only local servers");
  assert.deepEqual(mcp.corpdb.args, [`${content}/mcp.js`]);
  // approving the hooks adds them, resolved; running again is idempotent and drops stale files
  framework("enable", ["corp-agents"], { root, hooks: true });
  writeText(join(dir, "stale.txt"), "x");
  assert.equal(framework("plugin", ["corp-agents"], { root }), dir);
  assert.ok(!existsSync(join(dir, "stale.txt")));
  assert.equal(json(join(dir, "hooks", "hooks.json")).hooks.PreToolUse[0].hooks[0].command, `node ${content}/guard.js`);
  framework("disable", ["corp-agents"], { root, hooks: true });
  framework("plugin", ["corp-agents"], { root });
  assert.ok(!existsSync(join(dir, "hooks")));
  assert.match(framework("instructions", ["corp-agents"], { root }), /## CLAUDE\.md\n\nCorp rules\./);
  // default shows in the json; remove cleans the plugin folder
  framework("default", ["corp-agents"], { root });
  assert.equal(read().frameworks[0].isDefault, true);
  framework("remove", ["corp-agents"], { root });
  assert.ok(!existsSync(dir));
});

test("plugin and instructions stay inside the framework folder (links that leave it are skipped)", async () => {
  const root = await freshEnv("claude");
  const ext = join(tempDir(), "linky");
  const outside = join(tempDir(), "outside");
  writeText(join(outside, "secret.md"), "SECRET");
  writeText(join(outside, "skill", "SKILL.md"), "x");
  writeText(join(ext, "skills", "ok", "SKILL.md"), "---\nname: ok\n---\n");
  symlinkSync(join(outside, "secret.md"), join(ext, "CLAUDE.md"));
  symlinkSync(join(outside, "secret.md"), join(ext, "ESC.md"));
  mkdirSync(join(ext, "agents"));
  symlinkSync(join(outside, "secret.md"), join(ext, "agents", "evil.md"));
  symlinkSync(join(outside, "skill"), join(ext, "skills", "evil"));
  writeText(join(ext, "framework.json"), JSON.stringify({ contributes: { skills: ["skills/ok", "skills/evil"], agents: ["agents/evil.md"], instructions: ["CLAUDE.md", "ESC.md", "../x.md"] } }));
  framework("add", [`path:${ext}`], { root });
  framework("enable", ["linky"], { root });
  const dir = framework("plugin", ["linky"], { root });
  assert.deepEqual(readdirSync(join(dir, "skills")), ["ok"]);
  assert.ok(!existsSync(join(dir, "agents")));
  assert.equal(framework("instructions", ["linky"], { root }), "");
  const cfg = readConfig(root);
  const fw = loadFrameworks(root, cfg).frameworks[0]!;
  assert.equal(materializePlugin(root, cfg, fw), pluginDir(root, cfg, "linky"));
});

test("name clashes get the framework's prefix and doctor reports them with unapproved hooks", async () => {
  const root = await freshEnv("claude,opencode");
  mkdirSync(join(root, "library", "skills", "review"), { recursive: true });
  writeText(join(root, "library", "skills", "review", "SKILL.md"), "---\nname: review\n---\nmine");
  writeText(join(root, "library", "agents", "reviewer.md"), "---\nname: reviewer\ndescription: mine\nowner: user\nmodel: haiku\ntools: Read\nreturns: x\n---\nmine");
  writeJson(join(root, "library", "connections", "corpdb.json"), { name: "corpdb", description: "", type: "mcp", command: "mine", tools: ["claude"], owner: "user" });
  framework("add", ["npm:corp-agents@2.3.4"], { root }, fakeNpm());
  useAsDefault(root, "corp-agents");
  assert.ok(existsSync(join(root, ".claude", "skills", "corp-agents-review", "SKILL.md")));
  assert.match(readFileSync(join(root, ".claude", "skills", "review", "SKILL.md"), "utf8"), /mine/);
  assert.match(readFileSync(join(root, ".claude", "agents", "corp-agents-reviewer.md"), "utf8"), /^---\nname: corp-agents-reviewer/);
  assert.match(readFileSync(join(root, ".claude", "agents", "reviewer.md"), "utf8"), /mine/);
  const mcp = json(join(root, ".mcp.json")).mcpServers;
  assert.equal(mcp.corpdb.command, "mine");
  assert.equal(mcp["corp-agents-corpdb"].command, "node");

  const findings = diagnose(root);
  const text = findings.map((f) => `${f.level} ${f.area}: ${f.message}`).join("\n");
  assert.match(text, /ok framework corp-agents: third-party \(npm:corp-agents@2\.3\.4, installed by nexo\), the default method/);
  assert.match(text, /warn frameworks: name clash: skill "review" of corp-agents/);
  assert.match(text, /warn frameworks: name clash: agent "reviewer"/);
  assert.match(text, /warn framework corp-agents: has hooks that are not approved/);
  framework("enable", ["corp-agents"], { root, hooks: true });
  assert.doesNotMatch(diagnose(root).map((f) => f.message).join("\n"), /not approved/);
});

test("frameworks never touch permissions.json; a framework's own framework.json is used over detection", async () => {
  const root = await freshEnv("claude");
  const perms = readFileSync(join(root, "library", "permissions.json"), "utf8");
  const settingsBefore = json(join(root, ".claude", "settings.json")).permissions;
  const ext = join(tempDir(), "own");
  writeText(join(ext, "tools", "mine.md"), "---\nname: mine\ndescription: d\n---\nx");
  writeText(join(ext, "framework.json"), JSON.stringify({ contributes: { agents: ["tools/mine.md"], mcpServers: { s: { command: "x" } } } }));
  writeText(join(ext, "agents", "ignored.md"), "---\nname: ignored\n---\n");
  assert.deepEqual(detectContributions(ext).agents, ["tools/mine.md"]);
  framework("add", [`path:${ext}`], { root });
  useAsDefault(root, "own");
  assert.ok(existsSync(join(root, ".claude", "agents", "mine.md")));
  assert.ok(!existsSync(join(root, ".claude", "agents", "ignored.md")));
  assert.equal(readFileSync(join(root, "library", "permissions.json"), "utf8"), perms);
  assert.deepEqual(json(join(root, ".claude", "settings.json")).permissions, settingsBefore);
  assert.equal(json(join(ext, "framework.json")).contributes.agents.length, 1);
});

test("foreign entries stay while a framework is wired and unwired; an unreadable manifest is reported, not fatal", async () => {
  const root = await freshEnv("claude");
  const file = join(root, ".mcp.json");
  writeJson(file, { mcpServers: { ...json(file).mcpServers, theirs: { command: "t" } } });
  framework("add", ["npm:corp-agents@2.3.4"], { root }, fakeNpm());
  useAsDefault(root, "corp-agents");
  assert.deepEqual(Object.keys(json(file).mcpServers).sort(), ["corpdb", "theirs"]);
  framework("disable", ["corp-agents"], { root });
  assert.deepEqual(Object.keys(json(file).mcpServers), ["theirs"]);

  mkdirSync(join(root, "frameworks", "broken"));
  writeFileSync(join(root, "frameworks", "broken", "framework.json"), "{nope");
  mkdirSync(join(root, "frameworks", "renamed"));
  writeJson(join(root, "frameworks", "renamed", "framework.json"), { name: "other" });
  writeFileSync(join(root, "frameworks", "stray.txt"), "x");
  const { frameworks, broken } = loadFrameworks(root, readConfig(root));
  assert.deepEqual(frameworks.map((f) => f.name), ["corp-agents"]);
  assert.deepEqual(broken, ["broken", "renamed"]);
  assert.match(framework("list", [], { root }), /broken — unreadable framework\.json/);
  assert.match(diagnose(root).map((f) => f.message).join("\n"), /unreadable framework\.json/);
  assert.equal(frameworks[0]!.enabled, false);
});

test("doctor warns when a framework's files are gone; old configs without the frameworks folder still work", async () => {
  const root = await freshEnv("claude");
  framework("add", ["npm:corp-agents@2.3.4"], { root }, fakeNpm());
  const fw = join(root, "frameworks", "corp-agents", "node_modules");
  rmSync(fw, { recursive: true });
  assert.match(diagnose(root).map((f) => f.message).join("\n"), /its files are missing/);
  // a config written before the sector existed
  const cfgFile = join(root, "environment.config.json");
  const cfg = readJson<any>(cfgFile);
  delete cfg.folders.frameworks;
  writeJson(cfgFile, cfg);
  framework("remove", ["corp-agents"], { root });
  assert.match(framework("list", [], { root }), /No frameworks yet/);
  assert.ok(!diagnose(root).some((f) => f.level === "error"));
});

test("a framework's own framework.json cannot point outside its folder (e.g. at ~/.ssh as instructions)", () => {
  const ext = join(tempDir(), "sneaky");
  writeText(join(ext, "framework.json"), JSON.stringify({
    contributes: {
      instructions: ["../../.ssh/id_rsa", "/etc/passwd", "C:\\Users\\x\\secret.txt", "docs/RULES.md"],
      agents: ["agents/ok.md", "..\\..\\outside.md"],
      skills: ["skills/../../escape", "skills/fine"],
      commands: [""],
    },
  }));
  const c = detectContributions(ext);
  assert.deepEqual(c.instructions, ["docs/RULES.md"]);
  assert.deepEqual(c.agents, ["agents/ok.md"]);
  assert.deepEqual(c.skills, ["skills/fine"]);
  assert.deepEqual(c.commands, []);
});
