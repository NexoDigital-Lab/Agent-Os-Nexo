// Who may use this server: whoever holds the token it generates at startup. The token is written to
// .state/os/token-<port> (0600; agents are kept out of .state/os by the sessions guard); the browser enters once
// with ?token=…, which becomes an HttpOnly cookie, and from then on every /api call and WebSocket must carry it.
// Without this, any program on the machine could drive the API (see docs/en/security.md). /api/os/info stays open:
// it is the health check of the CLI and the desktop app and holds nothing sensitive.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

const tokens = new Map<number, string>();

/** Cookies ignore the port, so each agent-os-nexo on this machine (app, preview, desktop) has its own name. */
export const cookieName = (port: number) => `nexo_os_${port}`;
export const accessFile = (stateDir: string, port: number) => join(stateDir, `token-${port}`);

const TOKEN = /^[0-9a-f]{48}$/;

/**
 * The token a restart hands over (restart.ts), so the open page keeps its access. It arrives on stdin, never in the
 * environment: /proc/<pid>/environ keeps a process's start-up environment readable, and agents run as the same user.
 * The flag is removed at once so nothing this server spawns tries to read it again.
 */
export function takeInheritedToken(env: NodeJS.ProcessEnv = process.env, read: () => string = () => readFileSync(0, "utf8")): string | undefined {
  if (env.NEXO_ACCESS_TOKEN_STDIN !== "1") return undefined;
  delete env.NEXO_ACCESS_TOKEN_STDIN;
  let token = "";
  try {
    token = read().trim();
  } catch {
    return undefined;
  }
  return TOKEN.test(token) ? token : undefined;
}

/** The token for this run of the server on `port` (fresh, or the one a restart handed over), written where `nexo os` and the desktop app read it. */
export function issueAccess(stateDir: string, port: number, reuse?: string): string {
  const token = reuse && TOKEN.test(reuse) ? reuse : randomBytes(24).toString("hex");
  mkdirSync(stateDir, { recursive: true });
  const file = accessFile(stateDir, port);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  tokens.set(port, token);
  return token;
}

/** For tests: use this token on `port` (null: no access control, as before issueAccess). */
export function setAccessToken(port: number, token: string | null): void {
  if (token) tokens.set(port, token);
  else tokens.delete(port);
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function validToken(port: number, candidate: string | null | undefined): boolean {
  const token = tokens.get(port);
  return !!token && !!candidate && same(token, candidate);
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** True when the request carries this run's token (cookie, or an X-Nexo-Token header for scripts the user runs). */
export function hasAccess(req: IncomingMessage, port: number): boolean {
  if (!tokens.has(port)) return true;
  return validToken(port, cookie(req, cookieName(port))) || validToken(port, String(req.headers["x-nexo-token"] ?? ""));
}

export const accessCookie = (port: number, token: string) => `${cookieName(port)}=${token}; HttpOnly; SameSite=Strict; Path=/`;

/** Paths anyone may call: the health check. */
export const OPEN_PATHS = new Set(["/api/os/info"]);
