// Plan limits (5-hour session + weekly) for the rail meter. Two sources, most reliable first:
//  1. The Agent SDK's /usage data (`usage_EXPERIMENTAL...`, the claude.ai usage endpoint: real % + reset times) and
//     `rate_limit_event` messages from every query. Only for claude.ai subscriptions (not API key / Bedrock / Vertex).
//  2. Fallback, always computed: tokens and estimated $ in the rolling 5 h / 7 d windows from the local transcripts.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { query, type SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { PROJECTS_DIR, price } from "../../sessions/server/usage.ts";

const H = 3_600_000;
export const WINDOWS = { five_hour: 5 * H, seven_day: 168 * H } as const;
export type WindowId = keyof typeof WINDOWS;

type Plan = { pct: number; resetsAt: number | null; at: number; from: "usage" | "event" };
const plan: Partial<Record<WindowId, Plan>> = {};
let subscription: string | null = null;
let planKnown: boolean | null = null; // null = never asked, false = API key / 3P (no plan limits)

/** Normalizes a utilization to 0-100: the usage endpoint already uses percent, events may send a 0-1 fraction. */
export const toPct = (u: number, fraction: boolean) => Math.max(0, Math.min(100, fraction && u <= 1 ? u * 100 : u));

/** A `rate_limit_event` from any query (the shape is the SDK's SDKRateLimitInfo). */
export function noteRateLimit(info: { rateLimitType?: string; utilization?: number; resetsAt?: number; status?: string }, now = Date.now()) {
  const id = info.rateLimitType;
  if (id !== "five_hour" && id !== "seven_day") return;
  if (typeof info.utilization !== "number") return;
  const prev = plan[id];
  if (prev && prev.from === "usage" && now - prev.at < 5 * 60_000) return; // a fresh endpoint answer beats an event
  plan[id] = { pct: toPct(info.utilization, true), resetsAt: info.resetsAt ? info.resetsAt * 1000 : null, at: now, from: "event" };
  planKnown = true;
}

/** The SDK's /usage answer (from a live query or the probe below). */
export function noteUsage(u: SDKControlGetUsageResponse, now = Date.now()) {
  subscription = u.subscription_type;
  planKnown = u.rate_limits_available && !!u.rate_limits;
  if (!planKnown) return;
  for (const id of Object.keys(WINDOWS) as WindowId[]) {
    const w = u.rate_limits?.[id];
    if (w && typeof w.utilization === "number")
      plan[id] = { pct: toPct(w.utilization, false), resetsAt: w.resets_at ? Date.parse(w.resets_at) : null, at: now, from: "usage" };
  }
}

// ---- probe: ask the CLI for /usage without sending any prompt (no model call), at most every 5 minutes ----
// The SDK call, replaceable so tests can answer without a CLI.
export const deps = { query };

let probing: Promise<void> | null = null;
let lastProbe = 0;
export function probe(force = false): Promise<void> {
  if (probing) return probing;
  if (!force && Date.now() - lastProbe < 5 * 60_000) return Promise.resolve();
  lastProbe = Date.now();
  probing = (async () => {
    const abort = new AbortController();
    const idle = (async function* () {
      await new Promise<void>((r) => abort.signal.addEventListener("abort", () => r()));
    })();
    const q = deps.query({ prompt: idle, options: { settingSources: [], abortController: abort, persistSession: false } });
    const timer = setTimeout(() => abort.abort(), 20_000);
    try {
      noteUsage(await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));
    } catch {
      /* no CLI / no network / API changed: the transcript numbers still work */
    } finally {
      clearTimeout(timer);
      abort.abort();
      probing = null;
    }
  })();
  return probing;
}

// ---- local transcripts: [timestamp, tokens, cost] per message in the last 7 days ----
type Point = [number, number, number];
const fileCache = new Map<string, { mtime: number; pts: { id: string; p: Point }[] }>();

function scan(file: string, mtime: number, since: number) {
  const hit = fileCache.get(file);
  if (hit && hit.mtime === mtime) return hit.pts;
  const pts: { id: string; p: Point }[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const m = e.message;
    if (e.type !== "assistant" || !m?.usage || m.model === "<synthetic>" || !e.timestamp) continue;
    const ts = Date.parse(e.timestamp);
    if (!(ts >= since)) continue;
    const t = price(m.model ?? "", m.usage);
    pts.push({ id: m.id ?? e.uuid, p: [ts, t.input + t.output + t.cacheWrite, t.cost] });
  }
  fileCache.set(file, { mtime, pts });
  return pts;
}

export function localPoints(now = Date.now()): Point[] {
  const since = now - WINDOWS.seven_day;
  const seen = new Set<string>(); // resumed/forked sessions repeat earlier messages: count each once
  const out: Point[] = [];
  if (!existsSync(PROJECTS_DIR)) return out;
  const files: string[] = [];
  for (const d of readdirSync(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, d);
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".jsonl")) files.push(path.join(dir, f));
        else if (!f.includes(".")) {
          const sub = path.join(dir, f, "subagents");
          if (existsSync(sub)) for (const s of readdirSync(sub)) if (s.endsWith(".jsonl")) files.push(path.join(sub, s));
        }
      }
    } catch {}
  }
  for (const f of files) {
    const st = statSync(f);
    if (st.mtimeMs < since) continue;
    for (const { id, p } of scan(f, st.mtimeMs, since)) if (!seen.has(id) && seen.add(id)) out.push(p);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export type LimitWindow = {
  id: WindowId;
  label: string;
  /** Plan utilization 0-100, or null when only local numbers are known. */
  pct: number | null;
  resetsAt: number | null;
  /** "plan" = real % from claude.ai; "local" = rolling window from transcripts (resetsAt is an estimate). */
  source: "plan" | "local";
  tokens: number;
  cost: number;
  messages: number;
};

export function windows(points: Point[], now = Date.now()): LimitWindow[] {
  return (Object.keys(WINDOWS) as WindowId[]).map((id) => {
    const span = WINDOWS[id];
    const inWin = points.filter((p) => p[0] > now - span);
    const tokens = inWin.reduce((a, p) => a + p[1], 0);
    const cost = inWin.reduce((a, p) => a + p[2], 0);
    const known = plan[id];
    // A plan answer whose window already reset is stale: the % is back near 0 and unknown.
    const live = known && (!known.resetsAt || known.resetsAt > now) ? known : null;
    return {
      id,
      label: id === "five_hour" ? "5 h" : "week",
      pct: live ? Math.round(live.pct * 10) / 10 : null,
      resetsAt: live?.resetsAt ?? (inWin.length ? inWin[0][0] + span : null),
      source: live ? "plan" : "local",
      tokens,
      cost,
      messages: inWin.length,
    };
  });
}

export async function limits() {
  await probe();
  const now = Date.now();
  return {
    at: now,
    subscription,
    /** false = this account has no plan limits (API key / Bedrock / Vertex): only local numbers exist. */
    planAvailable: planKnown,
    windows: windows(localPoints(now), now),
  };
}
