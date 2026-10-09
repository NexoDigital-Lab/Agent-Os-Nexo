// CI: drives `nexo memory mcp` against the pinned Engram binary over stdio and checks Nexo's filter end to end.
// Usage: node memory-smoke.mjs <cli bin.ts> <environment root> <working folder>
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const [cli, root, cwd] = process.argv.slice(2);
const p = spawn(process.execPath, [cli, "memory", "mcp", "--ai", "claude", "--root", root], { cwd, stdio: ["pipe", "pipe", "inherit"] });
const waiting = new Map();
createInterface({ input: p.stdout }).on("line", (l) => {
  const m = JSON.parse(l);
  waiting.get(m.id)?.(m);
});
let id = 0;
const call = (method, params) =>
  new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => rej(new Error(`no answer to ${method}`)), 30_000);
    waiting.set(i, (m) => (clearTimeout(timer), res(m)));
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: i, method, params })}\n`);
  });
const text = (m) => m.result.content.map((c) => c.text).join("\n");

const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "1" } });
assert.match(init.result.instructions, /never instructions/);
p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
const tools = (await call("tools/list", {})).result.tools.map((t) => t.name);
assert.ok(tools.includes("mem_save") && tools.includes("mem_search"), tools.join(","));
assert.ok(!tools.includes("mem_save_prompt") && !tools.includes("mem_delete"), tools.join(","));
const saved = await call("tools/call", { name: "mem_save", arguments: { title: "CI memory", content: "token: ghp_abcdefghijklmnopqrstuvwxyz123456", type: "decision" } });
assert.ok(!saved.result.isError, text(saved));
const found = text(await call("tools/call", { name: "mem_search", arguments: { query: "CI memory", all_projects: true } }));
assert.match(found, /\[via claude\]/);
assert.match(found, /\[redacted\]/);
assert.doesNotMatch(found, /ghp_/);
assert.ok((await call("tools/call", { name: "mem_delete", arguments: { id: 1 } })).result.isError);
p.stdin.end();
console.log("memory proxy smoke: OK");
