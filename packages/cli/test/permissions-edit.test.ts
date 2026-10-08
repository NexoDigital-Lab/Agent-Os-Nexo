// Editing permissions one rule at a time: the pure edits, validation, the atomic write, `nexo permissions`, and
// that every AI's files pick the change up at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { create } from "../src/commands/project.ts";
import { permissions } from "../src/commands/permissions.ts";
import { editPermissions, removeRule, setDecision, setRule } from "../src/core/permedit.ts";
import type { Permissions } from "../src/core/permissions.ts";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

test("setRule moves a pattern between decisions; removeRule drops it; empty lists disappear", () => {
  const p: Permissions = { commands: { allow: ["git status*"], ask: ["npm install*"] } };
  setRule(p, "commands", "allow", " npm install* ");
  assert.deepEqual(p.commands, { allow: ["git status*", "npm install*"] });
  setRule(p, "files.edit", "deny", "secrets/**");
  assert.deepEqual(p.files, { edit: { deny: ["secrets/**"] } });
  assert.equal(removeRule(p, "commands", "git status*"), true);
  assert.equal(removeRule(p, "commands", "nothing"), false);
  assert.deepEqual(p.commands, { allow: ["npm install*"] });
  removeRule(p, "files.read", "x");
  assert.throws(() => setRule(p, "commands", "allow", "  "), /cannot be empty/);
  assert.throws(() => setRule(p, "commands", "allow", "a\nb"), /one line/);
  assert.throws(() => setRule(p, "commands", "allow", "x".repeat(201)), /at most 200/);
});

test("setDecision: default, os actions and connections; anything else is refused", () => {
  const p: Permissions = {};
  setDecision(p, "default", "deny");
  setDecision(p, "os.build", "allow");
  setDecision(p, "connections.notion.write", "ask");
  assert.deepEqual(p, { default: "deny", os: { build: "allow" }, connections: { notion: { write: "ask" } } });
  for (const bad of ["os.explode", "connections.notion", "connections.a b.read", "connections.a.b.read", "files.read", "nope"]) {
    assert.throws(() => setDecision(p, bad, "allow"), /Unknown setting/, bad);
  }
});

test("editPermissions validates before writing and leaves no temp file", () => {
  const dir = tempDir();
  const file = join(dir, "permissions.json");
  writeFileSync(file, JSON.stringify({ $comment: "kept", commands: { allow: ["ls*"] } }));
  editPermissions(file, (p) => setRule(p, "commands", "deny", "rm -rf*"));
  assert.deepEqual(json(file), { $comment: "kept", commands: { allow: ["ls*"], deny: ["rm -rf*"] } });
  assert.throws(() => editPermissions(file, (p) => void ((p as Record<string, unknown>).default = "maybe")), /Not saved — default/);
  assert.deepEqual(json(file).commands.deny, ["rm -rf*"], "a refused change leaves the file as it was");
  assert.deepEqual(readdirSync(dir), ["permissions.json"]);
  editPermissions(join(dir, "new.json"), (p) => setDecision(p, "default", "ask"));
  assert.deepEqual(json(join(dir, "new.json")), { default: "ask" });
});

test("nexo permissions: show, change a rule, and Claude's settings follow at once", async () => {
  const root = await freshEnv("claude");
  assert.match(permissions(undefined, [], { root }), /^library\/permissions\.json:\ndefault: /);
  const out = permissions("allow", ["commands", "make", "test*"], { root });
  assert.equal(out, 'commands "make test*" → allow (library/permissions.json). AI files refreshed.');
  assert.ok(json(join(root, "library", "permissions.json")).commands.allow.includes("make test*"));
  const settings = readFileSync(join(root, ".claude", "settings.json"), "utf8");
  assert.match(settings, /Bash\(make test/, "the Claude rule was regenerated");
  assert.match(permissions("show", [], { root }), /commands allow: .*make test\*/);
  assert.match(permissions("remove", ["commands", "make test*"], { root }), /removed/);
  assert.throws(() => permissions("remove", ["commands", "make test*"], { root }), /has no rule/);
  assert.match(permissions("set", ["os.build", "allow"], { root }), /os\.build → allow/);
  assert.equal(json(join(root, "library", "permissions.json")).os.build, "allow");
  for (const bad of [["allow"], ["allow", "nowhere", "x"], ["set", "os.build", "maybe"], ["explode"]]) {
    assert.throws(() => permissions(bad[0], bad.slice(1), { root }), /Usage/, bad.join(" "));
  }
});

test("nexo permissions --project writes the project's file, shows the effective rules, refreshes only it", async () => {
  const root = await freshEnv("claude");
  create("shop", { root });
  const out = permissions("deny", ["files.edit", "migrations/**"], { root, project: "shop" });
  assert.match(out, /projects\/shop\/context\/permissions\.json/);
  assert.deepEqual(json(join(root, "projects", "shop", "context", "permissions.json")).files.edit.deny, ["migrations/**"]);
  const effective = JSON.parse(permissions("show", [], { root, project: "shop", json: true }));
  assert.deepEqual(effective.project.files.edit.deny, ["migrations/**"]);
  assert.ok(effective.effective.files.edit.deny.includes("migrations/**"));
  assert.ok(existsSync(join(root, "projects", "shop", ".claude", "settings.json")));
  assert.throws(() => permissions("show", [], { root, project: "../etc" }), /Invalid project id/);
  assert.throws(() => permissions("show", [], { root, project: "nope" }), /No project "nope"/);
});
