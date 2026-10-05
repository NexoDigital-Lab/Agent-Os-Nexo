import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PtyLike } from "../server/session.ts";
import type { StoredHost } from "../server/vault.ts";

// session.ts wipes RUN_DIR on import and writes temp keys there: point it at a throwaway dir, never the real vault.
process.env.NEXO_SSH_DIR = mkdtempSync(path.join(os.tmpdir(), "agos-sess-"));
const { assertRunnable, cleanTerminal, connect, kill, readTail, runCommand, setShared, status } = await import("../server/session.ts");

class FakePty implements PtyLike {
  written: string[] = [];
  killed = false;
  private data: Array<(d: string) => void> = [];
  private exit: Array<() => void> = [];
  write = (d: string) => void this.written.push(d);
  resize = () => {};
  kill = () => void (this.killed = true);
  onData = (cb: (d: string) => void) => this.data.push(cb);
  onExit = (cb: () => void) => this.exit.push(cb);
  emit = (d: string) => this.data.forEach((cb) => cb(d));
  end = () => this.exit.forEach((cb) => cb());
}

const host: StoredHost = { id: "h1", name: "web", host: "10.0.0.5", port: 2222, user: "deploy", auth: "password", project: null, secret: "pw-secret-1" };
const CONNECTED = "\x1b]0;agos-ok\x07";

function open(tab: string, h: StoredHost = host) {
  const pty = new FakePty();
  let spawned: { file: string; args: string[]; env: Record<string, string> } | undefined;
  connect(tab, h, (file, args, env) => ((spawned = { file, args, env }), pty));
  return { pty, spawned: spawned! };
}

/** Plays the remote shell for one runCommand: echo the typed line, print `output`, then the marker. */
function answer(pty: FakePty, output: string, code: number) {
  const typed = pty.written.at(-1)!;
  const nonce = /__agos_(\w+)_%s__/.exec(typed)![1];
  pty.emit(typed.replace(/\r$/, "").replace(/^\x15/, "").replace(/\\n/g, "") + "\r\n" + output + `\r\n__agos_${nonce}_${code}__\r\n$ `);
}

test("cleanTerminal strips escapes, applies \\r overwrites and backspaces", () => {
  assert.equal(cleanTerminal("\x1b[32mok\x1b[0m\r\nprogress 10%\rprogress 100%\r\nab\x08c\x1b]0;title\x07\r\n"), "ok\nprogress 100%\nac\n");
});

test("password mode: args carry no secret, the prompt is answered once, the console becomes connected", () => {
  const { pty, spawned } = open("t-pw");
  assert.equal(spawned.file, "ssh");
  assert.ok(spawned.args.includes("PreferredAuthentications=password,keyboard-interactive"));
  assert.ok(spawned.args.includes("deploy@10.0.0.5"));
  assert.ok(!JSON.stringify(spawned).includes("pw-secret-1"));
  assert.equal(spawned.env.SSH_AUTH_SOCK, undefined);
  assert.equal(status("t-pw")?.state, "connecting");
  pty.emit("deploy@10.0.0.5's password: ");
  assert.deepEqual(pty.written, ["pw-secret-1\r"]);
  pty.emit("Permission denied, please try again.\r\ndeploy@10.0.0.5's password: ");
  assert.deepEqual(pty.written, ["pw-secret-1\r"], "a second prompt is left to the user");
  pty.emit(CONNECTED + "Welcome\r\n$ ");
  assert.equal(status("t-pw")?.state, "connected");
  assert.ok(!readTail("t-pw", 50).includes("pw-secret-1"));
  kill("t-pw");
});

test("runCommand returns the exit code and the output, without the echoed line or the marker", async () => {
  const { pty } = open("t-run");
  pty.emit(CONNECTED + "$ ");
  const p = runCommand("t-run", "uname -a", 5);
  // Pagers off first (git log, journalctl… would hold the console in less), then the command, then the marker.
  assert.match(pty.written.at(-1)!, /^\x15 export PAGER=cat GIT_PAGER=cat SYSTEMD_PAGER= MANPAGER=cat; uname -a; printf '\\n__agos_[0-9a-f]{12}_%s__\\n' "\$\?"\r$/);
  assert.equal(status("t-run")?.busy, true);
  assert.throws(() => assertRunnable("t-run"), /busy/);
  answer(pty, "Linux box 6.1 x86_64\r\nline two", 3);
  assert.deepEqual(await p, { status: "done", exitCode: 3, output: "Linux box 6.1 x86_64\nline two" });
  assert.equal(status("t-run")?.busy, false);
  kill("t-run");
});

test("runCommand redacts secrets in the output", async () => {
  const { pty } = open("t-red");
  pty.emit(CONNECTED + "$ ");
  const p = runCommand("t-red", "cat app.conf", 5);
  answer(pty, "DB_PASSWORD=hunter2\r\nok", 0);
  const r = await p;
  assert.ok(!r.output.includes("hunter2") && r.output.includes("[redacted]"));
  kill("t-red");
});

test("runCommand times out with Ctrl+C and frees the console", async () => {
  const { pty } = open("t-to");
  pty.emit(CONNECTED + "$ ");
  const p = runCommand("t-to", "sleep 99", 1);
  pty.emit("sleep 99; printf '\\n__agos_x_%s__\\n' \"$?\"\r\n");
  const r = await p;
  assert.equal(r.status, "timeout");
  assert.equal(r.exitCode, null);
  assert.equal(pty.written.at(-1), "\x03");
  assert.equal(status("t-to")?.busy, false);
  kill("t-to");
});

test("a password prompt during a run reports waiting_password and keeps the console busy until the marker", { timeout: 10_000 }, async () => {
  const { pty } = open("t-sudo");
  pty.emit(CONNECTED + "$ ");
  const p = runCommand("t-sudo", "sudo ls /root", 20);
  const typed = pty.written.at(-1)!;
  pty.emit("[sudo] password for deploy: ");
  const r = await p;
  assert.equal(r.status, "waiting_password");
  assert.equal(status("t-sudo")?.busy, true);
  const nonce = /__agos_(\w+)_%s__/.exec(typed)![1];
  pty.emit(`\r\nfile\r\n__agos_${nonce}_0__\r\n`);
  assert.equal(status("t-sudo")?.busy, false);
  kill("t-sudo");
});

test("connect state machine: closed on exit, reconnect reuses the tab, kill closes the pty", () => {
  const first = open("t-sm");
  setShared("t-sm", true);
  first.pty.emit(CONNECTED);
  first.pty.end();
  assert.equal(status("t-sm")?.state, "closed");
  assert.throws(() => assertRunnable("t-sm"), /closed/);
  const second = open("t-sm");
  assert.equal(status("t-sm")?.state, "connecting");
  assert.equal(status("t-sm")?.shared, true, "sharing survives a reconnect");
  first.pty.end(); // a late event from the dead pty must not touch the new one
  assert.equal(status("t-sm")?.state, "connecting");
  kill("t-sm");
  assert.equal(second.pty.killed, true);
  assert.equal(status("t-sm"), null);
});

const ready = (tab: string, h: StoredHost = host) => {
  const o = open(tab, h);
  o.pty.emit(CONNECTED + "$ ");
  return o;
};

test("args disable connection sharing; no quiet-time fallback marks the console connected", async () => {
  const { pty, spawned } = open("t-args");
  assert.ok(spawned.args.join(" ").includes("-o ControlMaster=no -o ControlPath=none"));
  pty.emit("Last login: now\r\n");
  await new Promise((r) => setTimeout(r, 4_600));
  assert.equal(status("t-args")?.state, "connecting");
  kill("t-args");
});

test("only ssh's own password prompt is answered", () => {
  const { pty } = open("t-prompt");
  pty.emit("Banner: enter your password: ");
  pty.emit("\r\nother@host's password: ");
  assert.deepEqual(pty.written, []);
  pty.emit("\r\n(deploy@10.0.0.5) Password: ");
  assert.deepEqual(pty.written, ["pw-secret-1\r"]);
  kill("t-prompt");
});

test("key passphrase is answered only for the temp key path", () => {
  const { pty, spawned } = open("t-key", { ...host, auth: "key", secret: "-----BEGIN KEY-----\nx\n-----END KEY-----", passphrase: "pp-1" });
  const keyFile = spawned.args[spawned.args.indexOf("-i") + 1];
  pty.emit("Enter passphrase for key '/etc/other': ");
  assert.deepEqual(pty.written, []);
  pty.emit(`\r\nEnter passphrase for key '${keyFile}': `);
  assert.deepEqual(pty.written, ["pp-1\r"]);
  kill("t-key");
});

test("sharing is from now on: earlier console text is not readable, and toggling moves the offset", () => {
  const { pty } = ready("t-sh");
  pty.emit("before sharing\r\n$ ");
  setShared("t-sh", true);
  pty.emit("after sharing\r\n$ ");
  const t1 = readTail("t-sh", 50);
  assert.ok(t1.includes("after sharing") && !t1.includes("before sharing"));
  setShared("t-sh", false);
  pty.emit("while private\r\n$ ");
  setShared("t-sh", true);
  assert.ok(!readTail("t-sh", 50).includes("while private"));
  kill("t-sh");
});

test("redaction covers the whole window before cutting to N lines", () => {
  const { pty } = ready("t-win");
  setShared("t-win", true);
  pty.emit("-----BEGIN OPENSSH PRIVATE KEY-----\r\nAAAAB3NzaC1yc2E\r\nSECRETBODY\r\n-----END OPENSSH PRIVATE KEY-----\r\n$ ");
  const t = readTail("t-win", 2);
  assert.ok(!t.includes("SECRETBODY"));
  kill("t-win");
});

test("runCommand refuses when the console is not at a shell prompt, and types nothing", () => {
  const { pty } = open("t-np");
  pty.emit(CONNECTED + "[sudo] password for deploy: ");
  const before = pty.written.length;
  assert.throws(() => runCommand("t-np", "ls", 5), /not at a shell prompt/);
  assert.equal(pty.written.length, before);
  assert.equal(status("t-np")?.busy, false);
  kill("t-np");
});

test("a database or language REPL is not a shell prompt: nothing is typed into it", () => {
  for (const [id, prompt] of [["t-mysql", "mysql> "], ["t-py", ">>> "], ["t-psql", "app=# "], ["t-psql2", "app=> "]]) {
    const { pty } = open(id!);
    pty.emit(CONNECTED + `deploy@web:~$ mysql\r\n${prompt}`);
    const before = pty.written.length;
    assert.throws(() => runCommand(id!, "ls", 5), /not at a shell prompt/, prompt);
    assert.equal(pty.written.length, before, prompt);
    kill(id!);
  }
  const { pty } = open("t-zsh");
  pty.emit(CONNECTED + "me@host ~ % ");
  assert.doesNotThrow(() => void runCommand("t-zsh", "ls", 1).catch(() => {}), "zsh's % prompt still counts");
  kill("t-zsh");
});

test("a pending run resolves as closed on reconnect, pty exit and kill, and no Ctrl+C is sent afterwards", async () => {
  const a = ready("t-c1");
  const p1 = runCommand("t-c1", "sleep 5", 1);
  const second = open("t-c1");
  assert.equal((await p1).status, "closed");
  await new Promise((r) => setTimeout(r, 1_200));
  assert.ok(!second.pty.written.includes("\x03") && !a.pty.written.includes("\x03"));
  second.pty.emit(CONNECTED + "$ ");
  const p2 = runCommand("t-c1", "sleep 5", 30);
  second.pty.end();
  assert.deepEqual(await p2, { status: "closed", exitCode: null, output: "" });
  const b = ready("t-c2");
  const p3 = runCommand("t-c2", "sleep 5", 30);
  kill("t-c2");
  assert.equal((await p3).status, "closed");
  assert.equal(b.pty.killed, true);
  kill("t-c1");
});

test("a failing spawn leaves a closed console with a clean message", () => {
  connect("t-bad", host, () => {
    throw new Error("/secret/path exploded");
  });
  assert.equal(status("t-bad")?.state, "closed");
  assert.ok(!readTail("t-bad", 20).includes("/secret/path"));
  kill("t-bad");
});
