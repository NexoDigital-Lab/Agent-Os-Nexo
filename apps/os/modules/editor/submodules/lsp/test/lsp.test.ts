// Language servers bridged over WebSocket, against a fake server script (run with this Node), never a real one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { tempDir } from "../../../../../host/test/harness.ts";
import { attachLsp, killTabLsp, lspStatus, setLspWhich } from "../server/lsp.ts";

const dir = tempDir("lsp-fake-");
const fake = join(dir, "fake-ls.js");
// Echoes each framed message back as {echo}, preceded by a junk header block and split in two writes; {exit} ends it.
writeFileSync(fake, `
let buf = Buffer.alloc(0);
process.stdin.on("data", (c) => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    const sep = buf.indexOf("\\r\\n\\r\\n");
    if (sep < 0) return;
    const len = +/Content-Length: (\\d+)/.exec(buf.subarray(0, sep).toString())[1];
    if (buf.length < sep + 4 + len) return;
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString());
    buf = buf.subarray(sep + 4 + len);
    if (msg.exit) process.exit(0);
    process.stderr.write("noise\\n");
    process.stdout.write("X-Junk: 1\\r\\n\\r\\n");
    const out = JSON.stringify({ echo: msg });
    process.stdout.write("Content-Length: " + Buffer.byteLength(out) + "\\r\\n\\r\\n");
    setTimeout(() => process.stdout.write(out), 10);
  }
});
process.stdin.on("end", () => process.exit(0));
`);

let found: string | null = fake;
setLspWhich(async () => found);
after(() => setLspWhich());

// Set up before any test is registered: a top-level await after a test lets the root `after` hooks run early.
const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
attachLsp(server, port, (id) => {
  if (id === "missing") throw new Error("Unknown tab");
  return dir;
});
after(() => (server.closeAllConnections(), server.close()));

test("lspStatus reports an unknown language, a found server and a missing one with its hint", async () => {
  const none = await lspStatus("rust");
  assert.equal(none.available, false);
  assert.equal(none.name, null);
  assert.match(none.hint!, /No language server/);
  assert.deepEqual(await lspStatus("go"), { lang: "go", available: true, name: "gopls", hint: null });
  found = null;
  const missing = await lspStatus("go");
  assert.equal(missing.available, false);
  assert.match(missing.hint!, /Install Go/);
  found = fake;
  const py = await lspStatus("python");
  assert.equal(py.name, "pyright");
  assert.equal(py.available, true, "pyright ships with agent-os");
});

const open = (path: string, origin: string | null = `http://127.0.0.1:${port}`) =>
  new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: origin ? { Origin: origin } : {} });
const rejected = (ws: WebSocket) => new Promise<number>((resolve) => ws.on("unexpected-response", (_q, res) => resolve(res.statusCode!)));
const next = (ws: WebSocket) => new Promise<any>((resolve) => ws.once("message", (m) => resolve(JSON.parse(String(m)))));

test("a foreign origin is refused with 403, an unknown tab with 404", async () => {
  assert.equal(await rejected(open("/api/tabs/a/lsp/go", "http://evil.example")), 403);
  assert.equal(await rejected(open("/api/tabs/missing/lsp/go")), 404);
});

test("an unavailable server or an unknown language is a 424 (Object.prototype names included)", async () => {
  found = null;
  assert.equal(await rejected(open("/api/tabs/a/lsp/go")), 424);
  found = fake;
  assert.equal(await rejected(open("/api/tabs/a/lsp/constructor")), 424);
  assert.equal(await rejected(open("/api/tabs/a/lsp/rust")), 424);
});

test("messages are framed to the server and its framed replies come back as plain JSON, junk headers skipped", async () => {
  const ws = open("/api/tabs/b/lsp/go?x=1");
  await once(ws, "open");
  const reply = next(ws);
  ws.send(JSON.stringify({ id: 1, method: "initialize", note: "ñ" }));
  assert.deepEqual(await reply, { echo: { id: 1, method: "initialize", note: "ñ" } });
  const second = next(ws);
  ws.send(JSON.stringify({ id: 2 }));
  assert.deepEqual(await second, { echo: { id: 2 } });
  ws.close();
  await once(ws, "close");
});

test("a reconnect replaces the session, and killTabLsp ends the tab's servers", async () => {
  const first = open("/api/tabs/c/lsp/go");
  await once(first, "open");
  const firstClosed = once(first, "close");
  const second = open("/api/tabs/c/lsp/go");
  await once(second, "open");
  await firstClosed; // the old server was killed, so its socket closes
  const secondClosed = once(second, "close");
  killTabLsp("c");
  await secondClosed;
  killTabLsp("never-opened"); // harmless
});

test("when the server process exits the socket closes; a request URL that is not ours is ignored", async () => {
  const ws = open("/api/tabs/d/lsp/go");
  await once(ws, "open");
  const closed = once(ws, "close");
  ws.send(JSON.stringify({ exit: true }));
  await closed;
  const other = open("/somewhere/else");
  other.on("error", () => {});
  await new Promise((r) => setTimeout(r, 100));
  assert.notEqual(other.readyState, WebSocket.OPEN);
  other.terminate();
});

test("a server binary that cannot start closes the socket instead of crashing", async () => {
  found = join(dir, "does-not-exist");
  const ws = open("/api/tabs/e/lsp/go");
  await once(ws, "open");
  await once(ws, "close");
  found = fake;
});

test("messages sent after the server died are dropped", async () => {
  const ws = open("/api/tabs/f/lsp/go");
  await once(ws, "open");
  ws.send(JSON.stringify({ exit: true }));
  await once(ws, "close");
});
