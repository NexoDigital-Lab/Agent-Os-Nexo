// Helpers every module's server code shares: errors, JSON files, the route wrapper, request guards.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";

export const run = promisify(execFile);

/** An Error the `h()` route wrapper turns into `{ error }` with this HTTP status. */
export function httpError(status: number, message: string, extra: Record<string, unknown> = {}): Error & { status: number } {
  return Object.assign(new Error(message), { status, ...extra });
}

/** Parsed JSON file, or `fallback` when it's missing or invalid. Objects are merged over the fallback. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return fallback && typeof fallback === "object" && !Array.isArray(fallback) ? { ...fallback, ...v } : v;
  } catch {
    return fallback;
  }
}

type Handler = (req: Request, res: Response) => unknown;

/** Runs `fn`, sends its return value as JSON, and hands thrown errors (with `.status`) to the error middleware. */
export const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};

export const ok = { ok: true } as const;

/**
 * Runs a script in the user's login shell, so PATH matches their own terminal (plus ~/go/bin, where
 * `go install` puts binaries). The server itself may start with a shorter PATH.
 */
export function loginShell(script: string, timeout = 15_000): Promise<string | null> {
  return run("bash", ["-lc", `export PATH="$PATH:$HOME/go/bin"; ${script}`], { timeout }).then((r) => r.stdout.trim(), () => null);
}

export const loginWhich = (bin: string) => loginShell(`command -v ${bin}`, 10_000).then((p) => p || null);

/** Sends a file or folder to the desktop trash (recoverable). Throws instead of ever falling back to rm. */
export async function trash(abs: string, label = abs): Promise<void> {
  try {
    await run("gio", ["trash", abs]);
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw httpError(500, `Could not move ${label} to the trash (${String(err.stderr || err.message).trim()}). Nothing was deleted.`);
  }
}

const ownOrigins = (port: number) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
const ownHosts = (port: number) => [`localhost:${port}`, `127.0.0.1:${port}`];

/** WebSocket upgrades only from agent-os's own page: another site must never get a shell or a language server. */
export function sameOrigin(req: IncomingMessage, port: number): boolean {
  return ownOrigins(port).includes(String(req.headers.origin)) && ownHosts(port).includes(String(req.headers.host));
}

/**
 * Every HTTP request: the Host must be this server (a DNS-rebound evil.com resolving to 127.0.0.1 keeps its own
 * Host), and anything that changes state must come from our own page or a non-browser client (no Origin, e.g. curl).
 * Without this, any website the user visits could POST a terminal command or a container to the API.
 */
export function guardRequest(port: number) {
  const hosts = new Set(ownHosts(port));
  const origins = new Set(ownOrigins(port));
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const origin = req.headers.origin;
    const reads = req.method === "GET" || req.method === "HEAD";
    if (!hosts.has(String(req.headers.host)) || (!reads && origin !== undefined && !origins.has(origin))) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }
    // nosniff: files we serve (screenshots, repo images) are never reinterpreted as HTML/script. X-Agent-OS lets a
    // launcher tell this server apart from any other program that happens to hold its port.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Agent-OS", "1");
    next();
  };
}
