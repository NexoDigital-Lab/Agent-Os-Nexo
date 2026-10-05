import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert.match(os(undefined, undefined, { root }), /no builds yet/);
  assert.equal(os("next", undefined, { root }), "1.0.0");
  for (const v of ["1.0.0", "1.0.9"]) execFileSync("mkdir", ["-p", join(root, "os/versions", v)]);
  assert.equal(os("next", undefined, { root }), "1.1.0");
  assert.equal(os("versions", undefined, { root }), "  1.0.0\n* 1.0.9");
  os("use", "1.0.0", { root });
  assert.equal(os("versions", undefined, { root }), "* 1.0.0\n  1.0.9");
  os("use", "latest", { root });
  assert.equal(os("versions", undefined, { root }), "  1.0.0\n* 1.0.9");
  assert.throws(() => os("use", "3.0.0", { root }), /No build/);
});
