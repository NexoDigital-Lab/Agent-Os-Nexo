// The LSP status route and the tab-close hook, through real HTTP.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { mountModule, tempEnv, tempDir } from "../../../../../host/test/harness.ts";
import { initProjects } from "../../../../projects/server/projects.ts";
import { closeTab, openTab, restoreTabs } from "../../../../sessions/server/agent.ts";
import register from "../server/index.ts";
import { setLspWhich } from "../server/lsp.ts";

const script = join(tempDir("lsp-idx-"), "ls.js");
writeFileSync(script, "process.stdin.resume();");
setLspWhich(async () => script);
after(() => setLspWhich());

const env = tempEnv();
initProjects(env);
const dir = join(env.projects, "demo");
mkdirSync(join(dir, "code"), { recursive: true });
writeFileSync(join(dir, "AGENTS.md"), "# demo\n");
restoreTabs(join(env.state, "tabs.json"));
const tab = openTab({ project: "demo", dir, cwd: join(dir, "code"), title: "demo" });
const m = await mountModule(register, { env });

test("/lsp/:lang/status answers per language", async () => {
  assert.deepEqual((await m.get("/lsp/go/status")).body, { lang: "go", available: true, name: "gopls", hint: null });
  const unknown = await m.get("/lsp/cobol/status");
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.available, false);
});

test("the module attaches the websocket bridge and closing the tab ends its language server", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${m.ctx.port}/api/tabs/${tab}/lsp/go`, { headers: { Origin: `http://127.0.0.1:${m.ctx.port}` } });
  await once(ws, "open");
  const closed = once(ws, "close");
  closeTab(tab);
  await closed;
});
