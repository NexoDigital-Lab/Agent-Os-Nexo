// Real shells per tab (xterm.js ↔ node-pty over WebSocket). Each terminal lives on the server with its scrollback,
// so hiding the panel, switching to Chat or reloading the page reattaches instead of killing it. A terminal ends
// when you close it (✕), its shell exits, or its tab closes.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { WebSocketServer, type WebSocket } from "ws";
import { delimiter } from "node:path";
import { httpError, sameOrigin, userBinPath } from "../../../../../host/server/http.ts";

const SCROLLBACK = 256 * 1024; // chars replayed on reattach

type Term = { id: string; tab: string; title: string; cwd: string; pty: IPty; buffer: string; clients: Set<WebSocket>; exited: boolean; startedAt: number };
const terms = new Map<string, Term>(); // key `${tab}:${id}`

export type TermInfo = { id: string; title: string; startedAt: number };

export function listTerms(tab: string): TermInfo[] {
  return [...terms.values()].filter((t) => t.tab === tab).map(({ id, title, startedAt }) => ({ id, title, startedAt }));
}

/** What runs in the pty: the user's login shell by default; a provider (docker's dev containers) can swap in its own. */
export type ShellSpec = { file: string; args: string[]; env?: Record<string, string> };

/** "host": the tab's own shell; "container": the project's dev container. Undefined = the default login shell. */
export type ShellProvider = (project: string, where: "host" | "container") => ShellSpec | undefined;

const providers: ShellProvider[] = [];

/** Lets another module (docker/devenv) supply the shell for a project, e.g. with its dev container's tools first. */
export function addShellProvider(p: ShellProvider): void {
  providers.push(p);
}

/** The shell for a project: the first provider that answers, else the login shell. "container" needs a provider. */
export function shellFor(project: string, where: "host" | "container"): ShellSpec | undefined {
  for (const p of providers) {
    const s = p(project, where);
    if (s) return s;
  }
  if (where === "container") throw httpError(409, "This project has no dev container yet");
  return undefined;
}

/** Creates a shell for the tab; with `run`, types that command into it (Ctrl+C stops it, ↑ Enter re-runs it). */
export function createTerm(tab: string, cwd: string, title = "bash", run?: string, shell?: ShellSpec): TermInfo {
  const id = Math.random().toString(36).slice(2, 8);
  const { file, args } = shell ?? { file: process.env.SHELL || "bash", args: ["-l"] };
  const pty = spawnPty(file, args, {
    name: "xterm-256color",
    cols: 100,
    rows: 20,
    cwd,
    // The user's bin dirs always lead PATH: a server started from a launcher may lack them.
    env: { ...process.env, PATH: userBinPath().join(delimiter), ...shell?.env, TERM: "xterm-256color" } as Record<string, string>,
  });
  const t: Term = { id, tab, title, cwd, pty, buffer: "", clients: new Set(), exited: false, startedAt: Date.now() };
  terms.set(`${tab}:${id}`, t);
  pty.onData((d) => {
    t.buffer = (t.buffer + d).slice(-SCROLLBACK);
    for (const ws of t.clients) if (ws.readyState === ws.OPEN) ws.send(d);
  });
  pty.onExit(() => {
    t.exited = true;
    for (const ws of t.clients) ws.close();
    terms.delete(`${tab}:${id}`);
  });
  if (run) pty.write(run + "\r");
  return { id, title, startedAt: t.startedAt };
}

export function killTerm(tab: string, id: string) {
  terms.get(`${tab}:${id}`)?.pty.kill();
  terms.delete(`${tab}:${id}`);
}

export function killTabTerms(tab: string) {
  for (const t of [...terms.values()]) if (t.tab === tab) killTerm(tab, t.id);
}

/** Types into a live terminal (used by "Install" in Environment). */
export function writeTerm(tab: string, id: string, data: string) {
  const t = terms.get(`${tab}:${id}`);
  if (!t || t.exited) throw httpError(404, "Terminal closed");
  t.pty.write(data);
}

export function attachTerminal(server: Server, port: number) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = req.url?.match(/^\/api\/tabs\/([\w-]+)\/term\/([\w-]+)(?:\?.*)?$/);
    if (!m) return; // not ours (e.g. Vite HMR)
    // A web page on another origin must never get a shell on this machine.
    if (!sameOrigin(req, port)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const [, tab, id] = m;
    const t = terms.get(`${tab}:${id}`); // terminals are created over HTTP (POST /terms); this only attaches
    if (!t) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      t.clients.add(ws);
      if (t.buffer) ws.send(t.buffer);
      // A bad frame must never throw here: an exception in this listener would take the whole server down.
      ws.on("message", (raw) => {
        let msg: { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (t.exited) return;
        if (msg.type === "input" && typeof msg.data === "string") t.pty.write(msg.data);
        const cols = Number(msg.cols), rows = Number(msg.rows);
        if (msg.type === "resize" && cols > 0 && rows > 0 && cols < 1000 && rows < 1000) t.pty.resize(Math.floor(cols), Math.floor(rows));
      });
      ws.on("close", () => t.clients.delete(ws));
    });
  });
}
