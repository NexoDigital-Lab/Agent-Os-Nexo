// Language servers for the editor: one process per (tab, language), bridged WebSocket ↔ stdio. The browser speaks
// plain JSON-RPC messages; this side adds/strips LSP's Content-Length framing. Go → gopls, Python → pyright.
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { loginWhich, sameOrigin } from "../../../../../host/server/http.ts";

const require = createRequire(import.meta.url);

/** pyright ships with agent-os as a dependency: its language server script, run with this Node. */
function bundledPyright(): string | null {
  try {
    return require.resolve("pyright/langserver.index.js");
  } catch {
    return null;
  }
}

type Spec = { lang: string; name: string; find: () => Promise<string | null>; args: string[]; hint: string };

const which = loginWhich;

const SERVERS: Record<string, Spec> = {
  go: { lang: "go", name: "gopls", find: () => which("gopls"), args: [], hint: "Install Go, then gopls from the panel → 🧰 Environment" },
  python: {
    lang: "python",
    name: "pyright",
    find: async () => bundledPyright() ?? which("pyright-langserver"),
    args: ["--stdio"],
    hint: "pyright ships with agent-os: reinstall its dependencies (nexo os build)",
  },
};

export async function lspStatus(lang: string) {
  const spec = SERVERS[lang];
  if (!spec) return { lang, available: false, name: null, hint: "No language server for this language (TS/JS use Monaco's built-in one)" };
  const bin = await spec.find();
  return { lang, available: !!bin, name: spec.name, hint: bin ? null : spec.hint };
}

type Session = { proc: ChildProcess; clients: Set<WebSocket> };
const sessions = new Map<string, Session>(); // `${tab}:${lang}`

export function killTabLsp(tab: string) {
  for (const [k, s] of sessions) if (k.startsWith(tab + ":")) (s.proc.kill(), sessions.delete(k));
}

/** Content-Length framed stdout → one JSON string per message. */
function framer(onMessage: (json: string) => void) {
  let buf = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const len = Number(buf.subarray(0, sep).toString().match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(len)) {
        buf = buf.subarray(sep + 4); // junk header — skip it
        continue;
      }
      if (buf.length < sep + 4 + len) return;
      onMessage(buf.subarray(sep + 4, sep + 4 + len).toString("utf8"));
      buf = buf.subarray(sep + 4 + len);
    }
  };
}

export function attachLsp(server: Server, port: number, cwdForTab: (id: string) => string) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = req.url?.match(/^\/api\/tabs\/([\w-]+)\/lsp\/(\w+)(?:\?.*)?$/);
    if (!m) return;
    if (!sameOrigin(req, port)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      return socket.destroy();
    }
    const [, tab, lang] = m;
    const spec = SERVERS[lang];
    let cwd: string;
    try {
      cwd = cwdForTab(tab);
    } catch {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      return socket.destroy();
    }
    const bin = spec && (await spec.find());
    if (!bin) {
      socket.write("HTTP/1.1 424 Failed Dependency\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // One client per session: a reconnect (reload) restarts the server so it gets a fresh initialize.
      const key = `${tab}:${lang}`;
      sessions.get(key)?.proc.kill();
      // A .js server (the bundled pyright) runs with this same Node.
      const [cmd, args] = bin.endsWith(".js") ? [process.execPath, [bin, ...spec.args]] : [bin, spec.args];
      const proc = spawn(cmd, args, { cwd, env: { ...process.env, PATH: `${process.env.PATH}:${path.join(os.homedir(), "go", "bin")}` } });
      const s: Session = { proc, clients: new Set([ws]) };
      sessions.set(key, s);
      proc.stdout!.on("data", framer((json) => ws.readyState === ws.OPEN && ws.send(json)));
      proc.stderr!.on("data", () => {}); // servers log noise here
      proc.on("exit", () => {
        if (sessions.get(key) === s) sessions.delete(key);
        ws.close();
      });
      proc.on("error", () => ws.close());
      proc.stdin!.on("error", () => ws.close()); // EPIPE when the server died: unhandled, it would crash agent-os
      ws.on("message", (raw) => {
        if (proc.exitCode !== null || proc.killed) return;
        const body = Buffer.from(String(raw), "utf8");
        proc.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
        proc.stdin!.write(body);
      });
      ws.on("close", () => {
        if (sessions.get(key) === s) sessions.delete(key);
        proc.kill();
      });
    });
  });
}
