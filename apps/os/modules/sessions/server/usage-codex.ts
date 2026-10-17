// Codex persists one rollout JSONL per session under ~/.codex/sessions/YYYY/MM/DD/. Each file
// carries a session_meta header, turn_context events (model) and cumulative token_count events;
// the LAST token_count holds the session's totals. No prices are stored, so cost is estimated.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionUsage, Tokens } from "./usage.ts";

const ACTIVE_MS = 90_000; // same live window as usage.ts

// USD per 1M tokens: [input, output, cached input] — OpenAI's public list prices (checked
// 2026-10-17, developers.openai.com/api/docs/pricing). Codex has no cache-write rate: writes
// bill as plain input. A model absent from this table keeps its tokens and costs 0.
const GPT_PRICES: [RegExp, number, number, number][] = [
  [/gpt-5\.5-pro/, 30, 180, 30],
  [/gpt-5\.5/, 5, 30, 0.5],
  [/gpt-5\.4-mini/, 0.75, 4.5, 0.075],
  [/gpt-5\.4/, 2.5, 15, 0.25],
  [/gpt-5-pro/, 15, 120, 15],
  [/gpt-5-mini/, 0.25, 2, 0.025],
  [/gpt-5-nano/, 0.05, 0.4, 0.005],
  [/gpt-5/, 1.25, 10, 0.125],
];

type Usage = { input_tokens?: number; output_tokens?: number; cache_write_input_tokens?: number; cached_input_tokens?: number };

function price(model: string, u: Usage): Tokens {
  const [, pin, pout, pcached] = GPT_PRICES.find(([re]) => re.test(model)) ?? [null, 0, 0, 0];
  const t: Tokens = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite: u.cache_write_input_tokens ?? 0,
    cacheRead: u.cached_input_tokens ?? 0,
    cost: 0,
  };
  t.cost = (t.input * pin + t.output * pout + t.cacheWrite * pin + t.cacheRead * pcached) / 1e6;
  return t;
}

function codexDir(): string {
  return path.join(os.homedir(), ".codex", "sessions");
}

function rollouts(since: number): string[] {
  const root = codexDir();
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const d of readdirSync(root)) {
    const y = path.join(root, d);
    if (!statSync(y).isDirectory()) continue;
    for (const m of readdirSync(y)) {
      const md = path.join(y, m);
      if (!statSync(md).isDirectory()) continue;
      for (const day of readdirSync(md)) {
        const dd = path.join(md, day);
        if (!statSync(dd).isDirectory()) continue;
        for (const f of readdirSync(dd)) {
          if (!f.startsWith("rollout-") || !f.endsWith(".jsonl")) continue;
          const full = path.join(dd, f);
          if (statSync(full).mtimeMs >= since) out.push(full);
        }
      }
    }
  }
  return out;
}

/** Codex sessions touched in the last `days` days, newest first. Missing directory -> empty. */
export function listCodexSessions(days = 7): SessionUsage[] {
  const since = Date.now() - days * 86_400_000;
  const out: SessionUsage[] = [];
  for (const file of rollouts(since)) {
    // Fallback id from the file name: rollout-<timestamp>-<uuid>.jsonl -> <uuid>.
    const fallbackId = path.basename(file).replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "").replace(/\.jsonl$/, "");
    let id = fallbackId;
    let cwd: string | null = null;
    let source = "codex";
    let model = "?";
    let title: string | null = null;
    let start: string | null = null;
    let end: string | null = null;
    let total: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.timestamp) {
        start ??= e.timestamp;
        end = e.timestamp;
      }
      const p = e.payload ?? {};
      if (e.type === "session_meta") {
        id = p.session_id ?? fallbackId;
        cwd ??= p.cwd ?? null;
        source = p.originator ?? source;
      }
      if (e.type === "turn_context" && model === "?" && p.model) model = p.model;
      if (e.type === "response_item" && p.type === "message" && p.role === "user" && !title) {
        const text = (p.content ?? []).map((b: { text?: string }) => b.text ?? "").join("\n").trim();
        if (text && !text.startsWith("<")) title = text.slice(0, 160);
      }
      if (e.type === "event_msg" && p.type === "token_count" && p.info?.total_token_usage) total = price(model, p.info.total_token_usage);
    }
    const mtime = statSync(file).mtimeMs;
    const s: SessionUsage = {
      id,
      provider: "codex",
      file,
      cwd,
      project: cwd ? path.basename(cwd) : "?",
      title: title ?? id.slice(0, 8),
      source,
      start,
      end,
      active: Date.now() - mtime < ACTIVE_MS,
      usageAvailable: true,
      main: total,
      mainModels: model === "?" ? [] : [model],
      agents: [],
      byModel: { [model]: total },
      total,
    };
    if (s.total.cost > 0 || s.active) out.push(s);
  }
  return out.sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
}
