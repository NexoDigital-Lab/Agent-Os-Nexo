import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import type { Ev } from "../../sessions/server/sdkEvents.ts";
import type { SshPlan } from "../server/types.ts";
import type { PtyLike } from "../server/session.ts";
import type { StoredHost } from "../server/vault.ts";

// Keep the session module's temp-key dir away from the real vault (it wipes RUN_DIR on import).
process.env.NEXO_SSH_DIR = mkdtempSync(path.join(os.tmpdir(), "agos-tools-"));
const { connect, kill, setShared } = await import("../server/session.ts");
const { APPROVAL_TTL_MS, decidePlan, endTurn, sshHandlers } = await import("../server/tools.ts");

class FakePty implements PtyLike {
  written: string[] = [];
  private data: Array<(d: string) => void> = [];
  write = (d: string) => void this.written.push(d);
  resize = () => {};
  kill = () => {};
  onData = (cb: (d: string) => void) => this.data.push(cb);
  onExit = () => {};
  emit = (d: string) => this.data.forEach((cb) => cb(d));
}

const host: StoredHost = { id: "h", name: "web", host: "10.0.0.5", port: 22, user: "deploy", auth: "local", project: null };
const CONNECTED = "\x1b]0;agos-ok\x07";
const PROMPT = "\r\n$ ";

function setup(tab: string) {
  const pty = new FakePty();
  const open = () => connect(tab, host, () => pty);
  open();
  pty.emit(CONNECTED + "$ ");
  setShared(tab, true);
  const events: Ev[] = [];
  const abort = new AbortController();
  const h = sshHandlers(tab, (ev) => events.push(ev), abort.signal);
  return { pty, h, events, reconnect: open };
}

const out = (r: { content: Array<{ text: string }> }) => r.content[0].text;
const json = (r: { content: Array<{ text: string }> }) => JSON.parse(out(r));

/** Plays the remote shell for the command just typed. */
function finish(pty: FakePty, code = 0, output = "ok") {
  const nonce = /__agos_(\w+)_%s__/.exec(pty.written.at(-1)!)![1];
  pty.emit(`\r\n${output}\r\n__agos_${nonce}_${code}__${PROMPT}`);
}

const STEP = "systemctl restart nginx";
const plan = (h: ReturnType<typeof sshHandlers>, commands: string[] = [STEP]) => h.plan({ summary: "reiniciar", steps: commands.map((command) => ({ command, why: "x" })) });
const planOf = (e: Ev) => (e.kind === "module" && e.module === "ssh" && e.type === "plan" ? (e.data as SshPlan) : null);
const pendingId = (events: Ev[]) => (events.find((e) => planOf(e)?.status === "pending") as Extract<Ev, { kind: "module" }>).id;

async function approvedPlan(tab: string, commands?: string[]) {
  const s = setup(tab);
  const p = plan(s.h, commands);
  assert.equal(decidePlan(pendingId(s.events), true), true);
  assert.match(out(await p), /Plan approved/);
  return s;
}

test("nothing works while the console is not shared", async () => {
  const s = setup("tt-ns");
  setShared("tt-ns", false);
  assert.match(out(await s.h.read({})), /not shared/);
  assert.match(out(await s.h.run({ command: "ls" })), /not shared/);
  kill("tt-ns");
});

async function runStep(s: ReturnType<typeof setup>, command = STEP, code = 0) {
  const p = s.h.run({ command });
  const typed = s.pty.written.length;
  finish(s.pty, code);
  return { r: await p, typed };
}

test("an approved plan step runs exactly once", async () => {
  const s = await approvedPlan("tt-once");
  const { r } = await runStep(s);
  assert.equal(json(r).status, "done");
  const second = await s.h.run({ command: STEP });
  assert.match(out(second), /changes things/);
  assert.equal((second as { isError?: boolean }).isError, true);
  kill("tt-once");
});

test("a step that is not in the plan is refused; a rejected plan approves nothing", async () => {
  const s = setup("tt-rej");
  const p = plan(s.h);
  decidePlan(pendingId(s.events), false);
  assert.match(out(await p), /rejected/);
  assert.deepEqual(s.events.map((e) => planOf(e)?.status ?? false), ["pending", "rejected"].map((st) => st));
  assert.match(out(await s.h.run({ command: STEP })), /changes things/);
  const t = await approvedPlan("tt-other");
  assert.match(out(await t.h.run({ command: "systemctl restart apache2" })), /changes things/);
  kill("tt-rej");
  kill("tt-other");
});

test("read-only commands need no plan", async () => {
  const s = setup("tt-ro");
  const { r } = await runStep(s, "ls -la");
  assert.equal(json(r).status, "done");
  kill("tt-ro");
});

test("approvals expire when sharing is turned off", async () => {
  const s = await approvedPlan("tt-unshare");
  setShared("tt-unshare", false);
  setShared("tt-unshare", true);
  assert.match(out(await s.h.run({ command: STEP })), /changes things/);
  kill("tt-unshare");
});

test("approvals expire when the turn ends and when the console reconnects", async () => {
  const a = await approvedPlan("tt-turn");
  endTurn("tt-turn");
  assert.match(out(await a.h.run({ command: STEP })), /changes things/);
  const b = await approvedPlan("tt-recon");
  b.reconnect();
  b.pty.emit(CONNECTED + "$ ");
  assert.match(out(await b.h.run({ command: STEP })), /changes things/);
  kill("tt-turn");
  kill("tt-recon");
});

test("approvals expire after 30 minutes", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    const s = await approvedPlan("tt-ttl");
    mock.timers.tick(APPROVAL_TTL_MS + 1);
    assert.match(out(await s.h.run({ command: STEP })), /changes things/);
    kill("tt-ttl");
  } finally {
    mock.timers.reset();
  }
});

test("a timed-out approved step stays approved and the note says so", async () => {
  const s = await approvedPlan("tt-to");
  const p = s.h.run({ command: STEP, timeoutSec: 1 });
  const r = json(await p);
  assert.equal(r.status, "timeout");
  assert.match(r.note, /still approved/);
  s.pty.emit(PROMPT);
  const { r: again } = await runStep(s);
  assert.equal(json(again).status, "done");
  kill("tt-to");
});

test("commands with invisible or confusable characters are rejected in ssh_run and ssh_plan", async () => {
  const s = setup("tt-inv");
  const before = s.pty.written.length;
  for (const bad of ["ls\u200b -la", "ls\u00a0-la", "ls \u202e/etc", "ls\u2028-la", "ls\u2066x"]) {
    const run = await s.h.run({ command: bad });
    assert.match(out(run), /invisible characters; write it in ASCII/);
    assert.match(out(await plan(s.h, [bad])), /invisible characters; write it in ASCII/);
  }
  assert.equal(s.pty.written.length, before);
  assert.equal(s.events.length, 0, "a rejected plan is never shown to the user");
  kill("tt-inv");
});

test("ssh_read returns only what the console produced after sharing was turned on", async () => {
  const pty = new FakePty();
  connect("tt-off", host, () => pty);
  pty.emit(CONNECTED + "secret-before-share\r\n$ ");
  setShared("tt-off", true);
  pty.emit("visible-after\r\n$ ");
  const h = sshHandlers("tt-off", () => {}, new AbortController().signal);
  const t = out(await h.read({}));
  assert.ok(t.includes("visible-after") && !t.includes("secret-before-share"));
  kill("tt-off");
});
