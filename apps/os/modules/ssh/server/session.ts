// One SSH console per tab: `ssh` in a pty, with its scrollback, shared with the web terminal over a WebSocket. The
// saved password / key passphrase are typed into the prompts by this process, so neither the browser nor the agent sees
// them. The agent only ever gets the console through `readTail` / `runCommand`, and only while the user shares it.
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { spawn as spawnPty } from "@lydell/node-pty";
import { WebSocketServer, type WebSocket } from "ws";
import { sameOrigin, userBinPath } from "../../../host/server/http.ts";
import { redact } from "./policy.ts";
import type { SshConnState, SshSessionInfo } from "./types.ts";
import { RUN_DIR, type StoredHost } from "./vault.ts";

const SCROLLBACK = 256 * 1024;
const AUTO_ANSWER_MS = 30_000; // the saved password is typed only this soon after connecting
const KEY_LIFE_MS = 20_000; // the temp key file survives this long (see armKeyTimer)
const HOSTKEY_HOLD_MS = 120_000; // while the host-key question waits for the user, keep the key file longer
const MAX_OUTPUT = 20_000;
const MAX_RAW = 1_000_000;
// ssh runs LocalCommand once the connection is authenticated: an invisible title sequence tells us "connected".
const CONNECTED = "\x1b]0;agos-ok\x07";
const LOCAL_COMMAND = "printf '\\033]0;agos-ok\\007'";
const IDLE_PROMPT = /[$#%>] $|[$#]$/; // a shell waiting for a command, as the last visible console line

/** The slice of a pty this module uses: node-pty's IPty satisfies it, and tests can fake it. */
export type PtyLike = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): unknown;
  onExit(cb: () => void): unknown;
};
export type Spawn = (file: string, args: string[], env: Record<string, string>) => PtyLike;

const realSpawn: Spawn = (file, args, env) =>
  spawnPty(file, args, { name: "xterm-256color", cols: 100, rows: 24, cwd: os.homedir(), env });

export type RunResult = { exitCode: number | null; output: string; status: "done" | "timeout" | "waiting_password" | "closed" };

type Run = {
  nonce: string;
  raw: string;
  lastData: number;
  orphan: boolean; // already answered "waiting_password": the command still runs, the marker will clear it
  onMarker: (code: number) => void;
  cancel: (status: "closed", withOutput?: boolean) => void; // settles the pending promise from outside (pty ended, unshared)
};

type Sess = {
  tabId: string;
  hostId: string;
  hostName: string;
  state: SshConnState;
  shared: boolean;
  sharedFrom: number; // `total` when sharing was last turned on: the agent sees only console text after it
  total: number; // every char the console ever produced (buffer is only its tail)
  pty?: PtyLike;
  gen: number; // bumped on every (re)connect so a dead pty's late events are ignored
  buffer: string;
  tail: string; // last chars, to look for prompts
  clients: Set<WebSocket>;
  run: Run | null;
  keyDir?: string;
  keyTimer?: NodeJS.Timeout;
  authUntil: number;
  hostKeyPending: boolean;
};
const sessions = new Map<string, Sess>();

/** Key files a crashed server left behind (called at register, once RUN_DIR is set). */
export const cleanRunDir = () => RUN_DIR && rmSync(RUN_DIR, { recursive: true, force: true });
process.once("exit", () => killAll());

// ── terminal text ───────────────────────────────────────────────────────────────────────────────────────────────

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[@-Z\\-_=>]/g;

/** Terminal bytes → the text a person would read: no escapes, carriage-return overwrites and backspaces applied. */
export function cleanTerminal(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(ANSI, "")
    .split("\n")
    .map((line) => {
      let s = line.split("\r").filter(Boolean).pop() ?? "";
      while (/[^\x08]\x08/.test(s)) s = s.replace(/[^\x08]\x08/g, "");
      return s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    })
    .join("\n");
}

const lastLine = (raw: string) => cleanTerminal(raw).split("\n").pop() ?? "";

// ── lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────────

function info(s: Sess): SshSessionInfo {
  return { tabId: s.tabId, hostId: s.hostId, hostName: s.hostName, state: s.state, shared: s.shared, busy: !!s.run };
}

function broadcast(s: Sess, text: string) {
  s.buffer = (s.buffer + text).slice(-SCROLLBACK);
  s.total += text.length;
  for (const ws of s.clients) if (ws.readyState === ws.OPEN) ws.send(text);
}

function dropKey(s: Sess) {
  clearTimeout(s.keyTimer);
  if (s.keyDir) rmSync(s.keyDir, { recursive: true, force: true });
  s.keyDir = undefined;
}

const armKeyTimer = (s: Sess, ms: number) => {
  clearTimeout(s.keyTimer);
  s.keyTimer = setTimeout(() => dropKey(s), ms);
};

function endPty(s: Sess) {
  s.gen++;
  dropKey(s);
  s.run?.cancel("closed");
  s.run = null;
  try {
    s.pty?.kill();
  } catch {
    // already gone
  }
  s.pty = undefined;
}

function setConnected(s: Sess) {
  if (s.state !== "connecting") return;
  s.state = "connected";
  dropKey(s); // auth is done: the key file has nothing left to do
}

const resetHooks: Array<(tabId: string) => void> = [];
/** `cb` runs whenever a tab's console is reconnected or stops being shared (tools.ts drops plan approvals there). */
export const onSessionReset = (cb: (tabId: string) => void) => void resetHooks.push(cb);
const reset = (tabId: string) => resetHooks.forEach((cb) => cb(tabId));

const reEscape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens (or reopens) the SSH console of a tab. The old pty, if any, is closed first. */
export function connect(tabId: string, host: StoredHost, spawn: Spawn = realSpawn): SshSessionInfo {
  let s = sessions.get(tabId);
  if (s) endPty(s);
  else {
    s = { tabId, hostId: host.id, hostName: host.name, state: "connecting", shared: false, sharedFrom: 0, total: 0, gen: 0, buffer: "", tail: "", clients: new Set(), run: null, authUntil: 0, hostKeyPending: false };
    sessions.set(tabId, s);
  }
  const sess = s;
  reset(tabId); // approvals belonged to the old connection
  const gen = sess.gen;
  Object.assign(sess, { hostId: host.id, hostName: host.name, state: "connecting", tail: "", authUntil: Date.now() + AUTO_ANSWER_MS, hostKeyPending: false });

  const args = ["-p", String(host.port), "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "PermitLocalCommand=yes", "-o", `LocalCommand=${LOCAL_COMMAND}`];
  if (host.auth === "password") args.push("-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no");
  let keyFile: string | undefined;
  let pty: PtyLike;
  try {
    if (host.auth === "key" && host.secret) {
      mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
      sess.keyDir = mkdtempSync(path.join(RUN_DIR, "k-")); // mkdtemp creates it 0700
      keyFile = path.join(sess.keyDir, "key");
      writeFileSync(keyFile, host.secret.replace(/\r\n?/g, "\n").trim() + "\n", { mode: 0o600 });
      args.push("-i", keyFile, "-o", "IdentitiesOnly=yes");
      armKeyTimer(sess, KEY_LIFE_MS);
    }
    args.push(`${host.user}@${host.host}`);

    const env: Record<string, string> = { ...(process.env as Record<string, string>), TERM: "xterm-256color", PATH: userBinPath().join(path.delimiter) };
    if (host.auth !== "local") delete env.SSH_AUTH_SOCK; // saved accesses must not borrow the user's agent keys
    broadcast(sess, sess.buffer ? "\r\n\x1b[2m— new connection —\x1b[0m\r\n" : "");
    pty = spawn("ssh", args, env);
  } catch {
    endPty(sess);
    sess.state = "closed";
    broadcast(sess, "\r\n\x1b[31mCould not launch ssh.\x1b[0m\r\n"); // no error text: it could carry paths of the key dir
    return info(sess);
  }
  sess.pty = pty;

  // Each saved secret is typed at most once.
  const answers: Answers = {
    password: host.auth === "password" ? host.secret : undefined,
    passphrase: host.auth === "key" ? host.passphrase : undefined,
    // ssh's own prompt forms, exactly: a remote banner that merely ends in "password:" gets nothing typed.
    passwordPrompt: new RegExp(`^(?:${reEscape(host.user)}@${reEscape(host.host)}'s password: ?|\\(${reEscape(host.user)}@${reEscape(host.host)}\\) Password: ?)$`),
    passphrasePrompt: keyFile ? new RegExp(`^Enter passphrase for key '${reEscape(keyFile)}': ?$`) : undefined,
  };

  pty.onData((d) => {
    if (sess.gen !== gen) return;
    broadcast(sess, d);
    sess.tail = (sess.tail + d).slice(-1000);
    if (sess.state === "connecting") authStep(sess, d, answers);
    if (sess.run) feedRun(sess, d);
  });
  pty.onExit(() => {
    if (sess.gen !== gen) return;
    dropKey(sess);
    sess.run?.cancel("closed"); // a command in flight ends with the console
    sess.run = null;
    sess.state = "closed";
    sess.pty = undefined;
    broadcast(sess, "\r\n\x1b[2m[SSH session closed]\x1b[0m\r\n");
  });
  return info(sess);
}

type Answers = { password?: string; passphrase?: string; passwordPrompt: RegExp; passphrasePrompt?: RegExp };

function authStep(s: Sess, chunk: string, answers: Answers) {
  if (chunk.includes(CONNECTED)) return setConnected(s);
  const last = lastLine(s.tail);
  if (/continue connecting/i.test(s.tail) && !s.hostKeyPending) {
    s.hostKeyPending = true; // the user decides the host-key question; give them time before the key file goes
    if (s.keyDir) armKeyTimer(s, HOSTKEY_HOLD_MS);
  }
  if (Date.now() >= s.authUntil) return;
  if (answers.password !== undefined && answers.passwordPrompt.test(last)) {
    s.pty?.write(answers.password + "\r");
    answers.password = undefined;
    s.tail = "";
  } else if (answers.passphrase !== undefined && answers.passphrasePrompt?.test(last)) {
    s.pty?.write(answers.passphrase + "\r");
    answers.passphrase = undefined;
    s.tail = "";
  }
}

/** What the user types in the console; Enter after the host-key question restarts the auth clocks. */
function userInput(s: Sess, data: string) {
  if (!s.pty || s.state === "closed") return;
  if (s.hostKeyPending && data.includes("\r")) {
    s.hostKeyPending = false;
    s.authUntil = Math.max(s.authUntil, Date.now() + AUTO_ANSWER_MS);
    if (s.keyDir) armKeyTimer(s, KEY_LIFE_MS);
  }
  if (s.run?.orphan && data.includes("\x03")) s.run = null; // the user stopped the command the agent was waiting on
  s.pty.write(data);
}

export function kill(tabId: string) {
  const s = sessions.get(tabId);
  if (!s) return;
  endPty(s);
  for (const ws of s.clients) ws.close();
  sessions.delete(tabId);
}

export function killAll() {
  for (const id of [...sessions.keys()]) kill(id);
}

export const status = (tabId: string): SshSessionInfo | null => {
  const s = sessions.get(tabId);
  return s ? info(s) : null;
};

export function setShared(tabId: string, shared: boolean): SshSessionInfo | null {
  const s = sessions.get(tabId);
  if (!s) return null;
  if (shared && !s.shared) s.sharedFrom = s.total; // "from now on": what came before stays private
  s.shared = shared;
  if (!shared) {
    s.run?.cancel("closed", false); // a command still running must not hand its output over after the switch is off
    s.run = null;
    reset(tabId);
  }
  return info(s);
}

// ── what the agent can do with the console ─────────────────────────────────────────────────────────────────────────

const cap = (text: string) => (text.length > MAX_OUTPUT ? `[…${text.length - MAX_OUTPUT} caracteres anteriores omitidos]\n` + text.slice(-MAX_OUTPUT) : text);

/** The last `lines` lines of the console, readable and redacted. */
export function readTail(tabId: string, lines: number): string {
  const s = sessions.get(tabId);
  if (!s) throw new Error("There is no SSH session in this tab");
  // Only what came after sharing was turned on, redacted as a whole before cutting to N lines: a window that starts
  // inside a private-key block would otherwise show its body without the BEGIN line that makes it recognizable.
  const visible = s.buffer.slice(Math.max(0, s.sharedFrom - (s.total - s.buffer.length)));
  return cap(redact(cleanTerminal(visible)).split("\n").slice(-lines).join("\n"));
}

/** Throws (Spanish message) unless the console is up: reading is fine even while a command runs. */
export function assertConnected(tabId: string) {
  const s = sessions.get(tabId);
  if (!s) throw new Error("There is no SSH session in this tab");
  if (s.state === "connecting") throw new Error("The console is still connecting");
  if (s.state === "closed") throw new Error("The SSH session is closed: ask the user to reconnect");
}

/** Throws unless a command can be launched right now. */
export function assertRunnable(tabId: string) {
  assertConnected(tabId);
  if (sessions.get(tabId)!.run) throw new Error("The console is busy with another command: wait for it to finish or read the console with ssh_read");
}

function feedRun(s: Sess, d: string) {
  const run = s.run!;
  run.raw = (run.raw + d).slice(-MAX_RAW);
  run.lastData = Date.now();
  const m = new RegExp(`__agos_${run.nonce}_(\\d+)__`).exec(run.raw);
  if (m) run.onMarker(Number(m[1]));
}

/** Everything the command printed: between the echoed command line and the marker, readable and redacted. */
function runOutput(raw: string, nonce: string): string {
  const marker = new RegExp(`__agos_${nonce}_\\d+__`).exec(raw); // the echoed command has `%s` there, not digits
  const lines = cleanTerminal(marker ? raw.slice(0, marker.index) : raw).split("\n");
  const echo = lines.findIndex((l) => l.includes(`__agos_${nonce}_%s`));
  return cap(redact(lines.slice(echo + 1).join("\n").trimEnd()));
}

/** The console's last visible line looks like a shell waiting for input (not a program, a pager or a password prompt). */
function atShellPrompt(s: Sess): boolean {
  const lines = cleanTerminal(s.buffer.slice(-2000)).split("\n").filter((l) => l.trim());
  return IDLE_PROMPT.test(lines.at(-1) ?? "");
}

/**
 * Types `command` into the console (the user watches it run) followed by a marker that prints its exit code, and
 * waits for it. `timeout`: Ctrl+C and return what came out. `waiting_password`: a password prompt is waiting for the
 * user; the command keeps running and the agent should ask the user to type it in the console. `closed`: the console
 * ended (reconnect, tab closed, pty exit) before the marker.
 */
export function runCommand(tabId: string, command: string, timeoutSec: number): Promise<RunResult> {
  assertRunnable(tabId);
  const s = sessions.get(tabId)!;
  // Typing into a program, a pager or a password prompt would feed it the agent's command as input.
  if (!atShellPrompt(s)) throw new Error("The console is not at a shell prompt (is a program open or a password pending?)");
  const nonce = randomBytes(6).toString("hex");
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout, poll: NodeJS.Timeout;
    const stop = () => (clearTimeout(timer), clearInterval(poll));
    const result = (status: RunResult["status"], exitCode: number | null, withOutput = true): RunResult => ({ status, exitCode, output: withOutput ? runOutput(run.raw, nonce) : "" });
    const run: Run = {
      nonce,
      raw: "",
      lastData: Date.now(),
      orphan: false,
      onMarker: (code) => {
        stop();
        if (s.run === run) s.run = null;
        if (!run.orphan) resolve(result("done", code));
      },
      cancel: (status, withOutput) => {
        stop();
        if (s.run === run) s.run = null;
        if (!run.orphan) resolve(result(status, null, withOutput));
      },
    };
    s.run = run;
    timer = setTimeout(() => {
      stop();
      if (s.run !== run) return; // already settled (reconnect, user's Ctrl+C): the Ctrl+C would hit something else
      s.pty?.write("\x03");
      s.run = null;
      resolve(result("timeout", null));
    }, timeoutSec * 1000);
    poll = setInterval(() => {
      if (!run.orphan && Date.now() - run.lastData > 1500 && /(password|passphrase|contraseña)[^\n]*:\s*$/i.test(lastLine(run.raw.slice(-500)))) {
        stop();
        run.orphan = true; // stays registered (busy) until its marker arrives or the user hits Ctrl+C
        resolve(result("waiting_password", null));
      }
    }, 500);
    // Ctrl+U first wipes whatever the user half-typed. The leading space keeps it out of bash history (HISTCONTROL=ignorespace).
    s.pty!.write(`\x15 ${command}; printf '\\n__agos_${nonce}_%s__\\n' "$?"\r`);
  });
}

// ── WebSocket: the xterm in the side panel ─────────────────────────────────────────────────────────────────────

/** Same protocol as the tab terminals: raw text out, JSON {input|resize} in. `authorized` checks the vault cookie. */
export function attachSshConsole(server: Server, port: number, authorized: (req: IncomingMessage) => boolean) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = req.url?.match(/^\/api\/ssh\/term\/([\w-]+)(?:\?.*)?$/);
    if (!m) return; // not ours
    const refuse = (line: string) => {
      socket.write(`HTTP/1.1 ${line}\r\n\r\n`);
      socket.destroy();
    };
    if (!sameOrigin(req, port)) return refuse("403 Forbidden");
    if (!authorized(req)) return refuse("401 Unauthorized");
    const s = sessions.get(m[1]);
    if (!s) return refuse("404 Not Found");
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (sessions.get(m[1]) !== s) return ws.close(); // the tab was closed while the upgrade was in flight
      s.clients.add(ws);
      if (s.buffer) ws.send(s.buffer);
      // A bad frame must never throw here: an exception in this listener would take the whole server down.
      ws.on("message", (raw) => {
        let msg: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.type === "input" && typeof msg.data === "string") userInput(s, msg.data);
        const cols = Number(msg.cols), rows = Number(msg.rows);
        if (msg.type === "resize" && cols > 0 && rows > 0 && cols < 1000 && rows < 1000) s.pty?.resize(Math.floor(cols), Math.floor(rows));
      });
      ws.on("close", () => s.clients.delete(ws));
    });
  });
}
