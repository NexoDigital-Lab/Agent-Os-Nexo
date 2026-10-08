// nexo import: each tool's own files read into connections and rules, the plan without --apply, stricter library
// rules kept, env values stored but never printed, and every AI's files refreshed after --apply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { importTool } from "../src/commands/import.ts";
import { parseCodexServers, readTool } from "../src/core/importers.ts";

function home(root: string): string {
  const h = tempDir();
  const put = (rel: string, text: string) => (mkdirSync(join(h, rel, ".."), { recursive: true }), writeFileSync(join(h, rel), text));
  put(".claude/settings.json", JSON.stringify({
    permissions: {
      allow: ["Bash(npm run fmt:*)", `Read(${root}/projects/**)`, "WebFetch(domain:x.com)"],
      deny: ["Bash(curl:*)", "Edit(/etc/**)"],
    },
  }));
  put(".claude.json", JSON.stringify({ mcpServers: { "My_Notion": { command: "npx", args: ["-y", "notion"], env: { NOTION_TOKEN: "secret-value-123" } }, web: { type: "http", url: "https://mcp.example.com" } } }));
  put(".gemini/settings.json", JSON.stringify({ mcpServers: { files: { command: "fs-mcp", args: ["."] } }, tools: { allowed: ["run_shell_command(git log)", "read_file"] } }));
  put(".config/opencode/opencode.json", `{
    // a comment OpenCode allows
    "mcp": { "pg": { "type": "local", "command": ["pg-mcp", "--ro"], "environment": { "PGURL": "postgres://u:p@h/db" } }, "far": { "type": "remote", "url": "https://far" } },
    "permission": { "bash": { "*": "ask", "docker *": "allow", "rm *": "deny" }, "edit": { "/elsewhere/**": "allow", "notes/**": "deny" } }
  }`);
  put(".codex/config.toml", [
    'model = "x"',
    "[mcp_servers.context7]",
    'command = "npx"',
    'args = ["-y", "@upstash/context7-mcp"]',
    'env = { API_KEY = "k" }',
    "",
    "[mcp_servers.remote1]",
    'url = "https://r"',
    "",
    "[mcp_servers.tbl]",
    'command = "t"',
    "[mcp_servers.tbl.env]",
    'A = "1" # comment',
  ].join("\n"));
  put(".codex/rules/default.rules", [
    'prefix_rule(pattern = ["gh", "pr", "view"], decision = "prompt", justification = "ok")',
    'prefix_rule(pattern = ["make"])',
    'prefix_rule(pattern = ["git", ["push", "fetch"]], decision = "forbidden")',
    'prefix_rule(pattern = ["dd"], decision = "forbidden")',
  ].join("\n"));
  return h;
}

test("Claude: Bash/Read/Edit rules and stdio servers; remote servers and paths outside the environment are reported", async () => {
  const root = await freshEnv("claude");
  const got = readTool("claude", home(root), root);
  assert.deepEqual(got.rules, [
    { area: "commands", decision: "allow", pattern: "npm run fmt*" },
    { area: "files.read", decision: "allow", pattern: "projects/**" },
    { area: "commands", decision: "deny", pattern: "curl*" },
  ]);
  assert.deepEqual(got.servers.map((s) => s.name), ["My_Notion"]);
  assert.ok(got.skipped.some((s) => /WebFetch.*no Nexo equivalent/.test(s)));
  assert.ok(got.skipped.some((s) => /Edit "\/etc\/\*\*": outside the environment/.test(s)));
  assert.ok(got.skipped.some((s) => /server "web": remote/.test(s)));
});

test("Gemini, OpenCode and Codex readers", async () => {
  const root = await freshEnv("claude");
  const h = home(root);
  const gemini = readTool("gemini", h, root);
  assert.deepEqual(gemini.rules, [{ area: "commands", decision: "allow", pattern: "git log*" }]);
  assert.deepEqual(gemini.servers, [{ name: "files", command: "fs-mcp", args: ["."], env: {} }]);
  assert.ok(gemini.skipped.some((s) => /read_file.*not a shell command/.test(s)));

  const opencode = readTool("opencode", h, root);
  assert.deepEqual(opencode.servers, [{ name: "pg", command: "pg-mcp", args: ["--ro"], env: { PGURL: "postgres://u:p@h/db" } }]);
  assert.deepEqual(opencode.rules, [
    { area: "commands", decision: "allow", pattern: "docker *" },
    { area: "commands", decision: "deny", pattern: "rm *" },
    { area: "files.edit", decision: "deny", pattern: "notes/**" },
  ]);
  assert.ok(opencode.skipped.some((s) => /"\/elsewhere\/\*\*": outside/.test(s)));
  assert.ok(opencode.skipped.some((s) => /server "far": remote/.test(s)));

  const codex = readTool("codex", h, root);
  assert.deepEqual(codex.servers, [
    { name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp"], env: { API_KEY: "k" } },
    { name: "tbl", command: "t", args: [], env: { A: "1" } },
  ]);
  assert.deepEqual(codex.rules, [
    { area: "commands", decision: "ask", pattern: "gh pr view*" },
    { area: "commands", decision: "allow", pattern: "make*" },
    { area: "commands", decision: "deny", pattern: "dd*" },
  ]);
  assert.ok(codex.skipped.some((s) => /alternatives/.test(s)));
  assert.ok(codex.skipped.some((s) => /server "remote1": remote/.test(s)));
  assert.deepEqual(parseCodexServers("[other]\ncommand = \"x\"\n"), [], "only mcp_servers tables");
  assert.deepEqual(readTool("codex", tempDir(), root).sources, []);
});

test("nexo import shows the plan, keeps stricter rules, never prints env values; --apply writes and refreshes", async () => {
  const root = await freshEnv("claude,opencode");
  const h = home(root);
  // The library already denies curl; Claude's own deny equals it, so it is "already".
  const plan = importTool("claude", { root, from: h });
  assert.match(plan, /\+ connection my_notion: npx -y notion \(env: NOTION_TOKEN\)/);
  assert.doesNotMatch(plan, /secret-value-123/, "an env value is never printed");
  assert.match(plan, /\+ commands allow "npm run fmt\*"/);
  assert.match(plan, /Run again with --apply to write 1 connection\(s\)/);
  assert.ok(!existsSync(join(root, "library", "connections", "my_notion.json")), "the plan writes nothing");

  const done = importTool("claude", { root, from: h, apply: true });
  assert.match(done, /Imported 1 connection\(s\) and \d+ rule\(s\); every AI's files refreshed\./);
  const conn = JSON.parse(readFileSync(join(root, "library", "connections", "my_notion.json"), "utf8"));
  assert.deepEqual([conn.command, conn.env.NOTION_TOKEN, conn.tools], ["npx", "secret-value-123", ["claude", "opencode"]]);
  const perms = JSON.parse(readFileSync(join(root, "library", "permissions.json"), "utf8"));
  assert.ok(perms.commands.allow.includes("npm run fmt*"));
  assert.match(readFileSync(join(root, ".mcp.json"), "utf8"), /my_notion/, "Claude sees the new server");
  assert.match(readFileSync(join(root, "opencode.json"), "utf8"), /my_notion/, "and so does OpenCode");

  const again = importTool("claude", { root, from: h });
  assert.match(again, /= connection my_notion.*already in the library, kept/);
  assert.match(again, /Nothing new to bring in\./);
});

test("a stricter library rule is kept; an imported stricter one tightens it", async () => {
  const root = await freshEnv("claude");
  const h = tempDir();
  mkdirSync(join(h, ".gemini"), { recursive: true });
  writeFileSync(join(h, ".gemini", "settings.json"), JSON.stringify({ tools: { allowed: ["run_shell_command(sudo)"] } }));
  const perms = JSON.parse(readFileSync(join(root, "library", "permissions.json"), "utf8"));
  assert.ok(perms.commands.deny.includes("sudo *"), "the normal preset denies sudo");
  writeFileSync(join(h, ".gemini", "settings.json"), JSON.stringify({ tools: { allowed: ["run_shell_command(sudo )"] } }));
  assert.match(importTool("gemini", { root, from: h }), /= commands allow "sudo\*" — the library already says deny/);

  mkdirSync(join(h, ".codex", "rules"), { recursive: true });
  writeFileSync(join(h, ".codex", "rules", "x.rules"), 'prefix_rule(pattern = ["git", "status"], decision = "forbidden")\n');
  const p2 = JSON.parse(readFileSync(join(root, "library", "permissions.json"), "utf8"));
  p2.commands.allow = [...(p2.commands.allow ?? []), "git status*"];
  writeFileSync(join(root, "library", "permissions.json"), JSON.stringify(p2));
  assert.match(importTool("codex", { root, from: h }), /~ commands "git status\*": allow → deny \(stricter\)/);
});

test("import: usage and an empty home", async () => {
  const root = await freshEnv("claude");
  assert.throws(() => importTool("cursor", { root }), /Usage: nexo import/);
  assert.match(importTool("gemini", { root, from: tempDir() }), /Nothing to import: no gemini configuration/);
});
