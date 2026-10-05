// HTTP client (Thunder Client style): collections + environments in os/data/http/store.json (never versioned, so tokens are safe),
// and requests sent from the server so the browser's CORS rules never get in the way.
import path from "node:path";
import { httpError, readJson, writeJson } from "../../../host/server/http.ts";

let FILE = "";

export function initStore(dataDir: string): void {
  FILE = path.join(dataDir, "store.json");
}
const MAX_BODY = 2 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export type KV = { k: string; v: string; on: boolean };
export type HttpRequest = { id: string; name: string; method: string; url: string; headers: KV[]; body: string };
export type Collection = { id: string; name: string; requests: HttpRequest[] };
export type Env = { id: string; name: string; vars: KV[] };
export type HttpStore = { collections: Collection[]; envs: Env[]; activeEnv: string | null };

const EMPTY: HttpStore = { collections: [], envs: [], activeEnv: null };

export const readStore = (): HttpStore => readJson(FILE, EMPTY);

export function writeStore(s: HttpStore) {
  if (!Array.isArray(s?.collections) || !Array.isArray(s?.envs))
    throw httpError(400, "Invalid format");
  writeJson(FILE, s);
}

/** Sends one already-resolved request (variables substituted by the client). */
export async function send(req: { method: string; url: string; headers: [string, string][]; body?: string }) {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw httpError(400, `Invalid URL: ${req.url}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw httpError(400, "Only http:// or https://");
  const method = req.method.toUpperCase();
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers: req.headers,
      body: method === "GET" || method === "HEAD" || !req.body ? undefined : req.body,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = Math.round(performance.now() - started);
    const text = buf.subarray(0, MAX_BODY).toString("utf8");
    return {
      ok: true as const,
      status: res.status,
      statusText: res.statusText,
      ms,
      size: buf.length,
      headers: [...res.headers.entries()],
      body: buf.length > MAX_BODY ? text + "\n… (response truncated to 2 MB)" : text,
    };
  } catch (err) {
    // Network-level failures (refused, DNS, timeout) are a normal outcome here, not a server error.
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const cause = e?.cause?.code ?? e?.cause?.message ?? e?.name;
    return { ok: false as const, ms: Math.round(performance.now() - started), error: `${e.message}${cause ? ` (${cause})` : ""}` };
  }
}

export type HttpResult = Awaited<ReturnType<typeof send>>;
