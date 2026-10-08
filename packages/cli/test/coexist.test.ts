// Nexo shares its generated files with other frameworks: it replaces what it wrote, keeps everything else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv } from "./helpers.ts";
import { Ledger, mergeHooks, mergeItems, mergeKeys, withAgentsPointer } from "../src/core/coexist.ts";
import { connect } from "../src/commands/connect.ts";
import { update } from "../src/commands/update.ts";
import { readJson, writeJson, writeText, readText } from "../src/core/fsx.ts";

test("mergeKeys: keeps foreign keys, replaces Nexo's, drops Nexo's previous keys that are gone", () => {
  const current = { mine: 1, old: 2, theirs: 3 };
  const r = mergeKeys(current, { mine: 9, fresh: 4 }, ["mine", "old"]);
  assert.deepEqual(r.value, { theirs: 3, mine: 9, fresh: 4 });
  assert.deepEqual(r.keys, ["mine", "fresh"]);
  assert.deepEqual(mergeKeys("nonsense", { a: 1 }, undefined).value, { a: 1 });
});

test("mergeKeys without a record: an entry equal to Nexo's is Nexo's, any other stays", () => {
  const r = mergeKeys({ a: { x: 1 }, b: { x: 2 } }, { a: { x: 1 } }, undefined);
  assert.deepEqual(r.value, { b: { x: 2 }, a: { x: 1 } });
  // a foreign key that clashes with a Nexo name is overridden by Nexo's value
  assert.deepEqual(mergeKeys({ a: 5 }, { a: 1 }, undefined).value, { a: 1 });
});

test("mergeItems and mergeHooks: foreign entries first, Nexo's after, no duplicates, empty events vanish", () => {
  const foreign = { hooks: [{ type: "command", command: "theirs" }] };
  const ours = { hooks: [{ type: "command", command: "ours" }] };
  const first = mergeItems([foreign, ours], [ours], undefined);
  assert.deepEqual(first.value, [foreign, ours]);
  assert.equal(mergeItems(undefined, [], undefined).value.length, 0);
  const h = mergeHooks({ Stop: [foreign, ours], Old: [ours] }, { Stop: [ours] }, { Stop: first.items, Old: first.items });
  assert.deepEqual(h.value, { Stop: [foreign, ours] });
  assert.deepEqual(Object.keys(h.items), ["Stop"]);
});

test("withAgentsPointer: pointer first, foreign lines kept, idempotent", () => {
  assert.equal(withAgentsPointer(null), "@../AGENTS.md");
  const text = withAgentsPointer("\n\n# Company rules\nBe nice\n@../AGENTS.md\n");
  assert.equal(text, "@../AGENTS.md\n# Company rules\nBe nice\n");
  assert.equal(withAgentsPointer(text), text);
});

test("Ledger: round-trips per relative path", async () => {
  const root = await freshEnv();
  const state = join(root, ".state");
  const a = new Ledger(root, state);
  assert.equal(a.get(join(root, "x.json")), undefined);
  a.set(join(root, "x.json"), { keys: { mcp: ["n"] } });
  a.save();
  assert.deepEqual(new Ledger(root, state).get(join(root, "x.json")), { keys: { mcp: ["n"] } });
});

test("generateAdapters keeps foreign MCP servers, hooks and CLAUDE.md lines; replaces and removes Nexo's own", async () => {
  const root = await freshEnv("claude,gemini,opencode");
  connect("alpha", { root, command: "npx", args: "alpha-mcp" });
  connect("beta", { root, command: "npx", args: "beta-mcp" });

  // another framework installs its things into the same files
  const mcpFile = join(root, ".mcp.json");
  const mcp = readJson<{ mcpServers: Record<string, unknown> }>(mcpFile);
  mcp.mcpServers.corp = { command: "corp-mcp" };
  writeJson(mcpFile, { ...mcp, other: true });
  const settingsFile = join(root, ".claude", "settings.json");
  const settings = readJson<{ hooks?: Record<string, unknown[]> }>(settingsFile);
  settings.hooks = { ...settings.hooks, PreToolUse: [...(settings.hooks?.PreToolUse ?? []), { matcher: "X", hooks: [{ type: "command", command: "corp-hook" }] }], Notification: [{ hooks: [{ type: "command", command: "corp-notify" }] }] };
  writeJson(settingsFile, settings);
  const md = join(root, ".claude", "CLAUDE.md");
  writeText(md, `${readText(md)}\n# Corp framework\n@corp/rules.md\n`);
  const ocFile = join(root, "opencode.json");
  const oc = readJson<{ mcp: Record<string, unknown> }>(ocFile);
  oc.mcp.corp = { type: "local", command: ["corp"] };
  writeJson(ocFile, oc);
  const gemFile = join(root, ".gemini", "settings.json");
  const gem = readJson<{ mcpServers: Record<string, unknown> }>(gemFile);
  gem.mcpServers.corp = { command: "corp" };
  writeJson(gemFile, gem);

  // Nexo drops "beta" from its library: its entry goes, the foreign neighbour stays
  rmSync(join(root, "library", "connections", "beta.json"));
  update({ root });

  const after = readJson<{ mcpServers: Record<string, unknown>; other?: boolean }>(mcpFile);
  assert.deepEqual(Object.keys(after.mcpServers).sort(), ["alpha", "corp"]);
  assert.equal(after.other, true);
  const hooks = readJson<{ hooks: Record<string, any[]> }>(settingsFile).hooks;
  assert.ok(hooks.PreToolUse!.some((h) => h.hooks[0].command === "corp-hook"));
  assert.ok(hooks.Notification);
  assert.equal(hooks.PreToolUse!.filter((h) => h.hooks[0].command === "corp-hook").length, 1);
  const text = readText(md);
  assert.ok(text.startsWith("@../AGENTS.md\n"));
  assert.match(text, /# Corp framework\n@corp\/rules\.md/);
  assert.deepEqual(Object.keys(readJson<{ mcp: object }>(ocFile).mcp).sort(), ["alpha", "corp"]);
  assert.deepEqual(Object.keys(readJson<{ mcpServers: object }>(gemFile).mcpServers).sort(), ["alpha", "corp"]);
  assert.ok(existsSync(join(root, ".state", "nexo", "generated.json")));
});

test("first run without a ledger keeps what is already there", async () => {
  const root = await freshEnv("claude");
  rmSync(join(root, ".state", "nexo", "generated.json"));
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { corp: { command: "c" } } }));
  update({ root });
  assert.deepEqual(Object.keys(readJson<{ mcpServers: object }>(join(root, ".mcp.json")).mcpServers), ["corp"]);
});

test("permissions stay generated from permissions.json alone", async () => {
  const root = await freshEnv("claude");
  const file = join(root, ".claude", "settings.json");
  const s = readJson<Record<string, any>>(file);
  const want = s.permissions;
  s.permissions = { allow: ["Bash(*)"] };
  writeJson(file, s);
  update({ root });
  assert.deepEqual(readJson<Record<string, any>>(file).permissions, want);
});
