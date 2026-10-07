// Terminals per tab, with a fake pty injected (no real shell is ever spawned) and a real WebSocket server.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import type { IPty } from "@lydell/node-pty";
import { tempDir } from "../../../../../host/test/harness.ts";
import { addShellProvider, attachTerminal, createTerm, killTabTerms, killTerm, listTerms, setPtySpawn, shellFor, writeTerm } from "../server/terminal.ts";

class FakePty {
  written: string[] = [];
  resized: Array<[number, number]> = [];
  killed = false;
  data: (d: string) => void = () => {};
  exit: () => void = () => {};
  file: string;
  args: string[];
  opts: { cwd?: string; env?: Record<string, string> };
  constructor(file: string, args: string[], opts: { cwd?: string; env?: Record<string, string> }) {
    this.file = file;
    this.args = args;
    this.opts = opts;
  }
  onData(cb: (d: string) => void) { this.data = cb; }
  onExit(cb: () => void) { this.exit = cb; }
  write(d: string) { this.written.push(d); }
  resize(c: number, r: number) { this.resized.push([c, r]); }
  kill() { this.killed = true; }
}
const spawned: FakePty[] = [];
setPtySpawn(((file: string, args: string[], opts: never) => {
  const p = new FakePty(file, args, opts);
  spawned.push(p);
  return p as unknown as IPty;
}) as never);
after(() => setPtySpawn());
// Set up before any test is registered: a top-level await after a test lets the root `after` hooks run early.
const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
attachTerminal(server, port);
after(() => (server.closeAllConnections(), server.close()));

const last = () => spawned[spawned.length - 1];

test("createTerm spawns the login shell in the tab's cwd, lists it, and types the run command", () => {
  const cwd = tempDir("term-cwd-");
  const info = createTerm("tab1", cwd, "bash", "npm test");
  assert.match(info.id, /^[a-z0-9]+$/);
  assert.deepEqual(listTerms("tab1").map((t) => t.title), ["bash"]);
  assert.deepEqual(listTerms("other"), []);
  assert.deepEqual(last().args, ["-l"]);
  assert.equal(last().opts.cwd, cwd);
  assert.equal(last().opts.env!.TERM, "xterm-256color");
  assert.deepEqual(last().written, ["npm test\r"]);
  killTabTerms("tab1");
  assert.deepEqual(listTerms("tab1"), []);
  assert.equal(last().killed, true);
});

test("a shell spec swaps the command and its environment", () => {
  createTerm("tab2", ".", "c", undefined, { file: "docker", args: ["exec"], env: { FOO: "1" } });
  assert.equal(last().file, "docker");
  assert.deepEqual(last().args, ["exec"]);
  assert.equal(last().opts.env!.FOO, "1");
  assert.deepEqual(last().written, []);
  killTabTerms("tab2");
});

test("output is buffered and a shell exit removes the terminal; writing to it is then a 404", () => {
  const { id } = createTerm("tab3", ".");
  last().data("hello");
  writeTerm("tab3", id, "ls\r");
  assert.deepEqual(last().written, ["ls\r"]);
  last().exit();
  assert.deepEqual(listTerms("tab3"), []);
  assert.throws(() => writeTerm("tab3", id, "x"), { status: 404 });
  assert.throws(() => writeTerm("tab3", "ghost", "x"), { status: 404 });
  killTerm("tab3", "ghost"); // closing an unknown terminal is harmless
});

test("shellFor asks providers in order; 'container' without one is a 409; 'host' falls back to the login shell", () => {
  assert.equal(shellFor("p", "host"), undefined);
  assert.throws(() => shellFor("p", "container"), { status: 409 });
  addShellProvider((project, where) => (project === "p" && where === "container" ? { file: "dc", args: [] } : undefined));
  assert.deepEqual(shellFor("p", "container"), { file: "dc", args: [] });
  assert.equal(shellFor("q", "host"), undefined);
  assert.throws(() => shellFor("q", "container"), { status: 409 });
});

// ---- WebSocket ----

const open = (path: string, origin: string | null = `http://127.0.0.1:${port}`) =>
  new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: origin ? { Origin: origin } : {} });
const rejected = (ws: WebSocket) => new Promise<number>((resolve) => ws.on("unexpected-response", (_q, res) => resolve(res.statusCode!)));

test("an upgrade from another origin gets 403 and an unknown terminal 404", async () => {
  assert.equal(await rejected(open("/api/tabs/t/term/x", "http://evil.example")), 403);
  assert.equal(await rejected(open("/api/tabs/t/term/x", null)), 403);
  assert.equal(await rejected(open("/api/tabs/t/term/ghost")), 404);
});

test("an attached client gets the scrollback, live output, input, and a clamped resize; bad frames are ignored", async () => {
  const { id } = createTerm("wt", ".");
  const pty = last();
  pty.data("past ");
  const ws = open(`/api/tabs/wt/term/${id}?x=1`);
  const got: string[] = [];
  ws.on("message", (m) => got.push(String(m)));
  await once(ws, "open");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(got, ["past "]);
  pty.data("live");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(got, ["past ", "live"]);
  ws.send("not json");
  ws.send(JSON.stringify({ type: "input", data: "echo hi\r" }));
  ws.send(JSON.stringify({ type: "input", data: 5 }));
  ws.send(JSON.stringify({ type: "resize", cols: 120.7, rows: 30 }));
  ws.send(JSON.stringify({ type: "resize", cols: 5000, rows: 30 }));
  ws.send(JSON.stringify({ type: "resize", cols: 0, rows: 30 }));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(pty.written, ["echo hi\r"]);
  assert.deepEqual(pty.resized, [[120, 30]]);
  const closed = once(ws, "close");
  pty.exit(); // the shell ends: clients are closed
  await closed;
  assert.deepEqual(listTerms("wt"), []);
});

test("messages after the shell exited are dropped, and a closed client is forgotten", async () => {
  const { id } = createTerm("wt2", ".");
  const pty = last();
  const ws = open(`/api/tabs/wt2/term/${id}`);
  await once(ws, "open");
  ws.close();
  await once(ws, "close");
  pty.data("after close"); // must not throw with no clients
  killTabTerms("wt2");
});
