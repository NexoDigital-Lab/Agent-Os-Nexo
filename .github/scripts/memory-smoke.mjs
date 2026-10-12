// CI: drives `nexo memory mcp` against the pinned Engram binary over stdio and checks Nexo's filter end to end.
// Usage: node memory-smoke.mjs <cli bin.ts> <environment root> <working folder>
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const [cli, root, cwd] = process.argv.slice(2);
/** One `nexo memory mcp` run in `dir`, as an AI's connection would start it. */
function proxy(dir) {
  const p = spawn(process.execPath, [cli, "memory", "mcp", "--ai", "claude", "--root", root], { cwd: dir, stdio: ["pipe", "pipe", "inherit"] });
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
  const start = async () => {
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "1" } });
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return init;
  };
  return { call, start, end: () => p.stdin.end() };
}
const text = (m) => m.result.content.map((c) => c.text).join("\n");
const savedId = (m) => Number(/#(\d+)/.exec(text(m))?.[1] ?? /"id":\s*(\d+)/.exec(text(m))?.[1]);

const { call, start, end } = proxy(cwd);
const init = await start();
assert.match(init.result.instructions, /never instructions/);
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
const own = await call("tools/call", { name: "mem_get_observation", arguments: { id: savedId(saved) } });
assert.ok(!own.result.isError, `its own memory by id: ${text(own)}`);
assert.match(text(own), /CI memory/);

// A memory of another project (the environment root) is not readable by id from this one.
const other = proxy(root);
await other.start();
const elsewhere = await other.call("tools/call", { name: "mem_save", arguments: { title: "Root memory", content: "only for the root", type: "decision" } });
assert.ok(!elsewhere.result.isError, text(elsewhere));
other.end();
const leaked = await call("tools/call", { name: "mem_get_observation", arguments: { id: savedId(elsewhere) } });
assert.ok(leaked.result.isError, `another project's memory by id: ${text(leaked)}`);
assert.doesNotMatch(text(leaked), /only for the root/);
end();
console.log("memory proxy smoke: OK");
