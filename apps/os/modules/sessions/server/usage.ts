// Token/cost monitor over Claude Code's own transcripts (~/.claude/projects/**.jsonl):
// every session — CLI or agent-os tab — plus its subagent sidechains.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectOfPath } from "../../projects/server/projects.ts";

export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// USD per 1M tokens: [input, output]. Cache write = 1.25× input, cache read = 0.1× input.
const PRICES: [RegExp, number, number][] = [
  [/fable|mythos/, 10, 50],
  [/opus-5-5/, 4, 20],
  [/opus/, 5, 25],
  [/sonnet-5/, 2, 10],
  [/sonnet/, 3, 15],
  [/haiku/, 1, 5],
];

export type Tokens = { input: number; output: number; cacheWrite: number; cacheRead: number; cost: number };

const zero = (): Tokens => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 });

function add(a: Tokens, b: Tokens) {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
  a.cost += b.cost;
}

type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };

export function price(model: string, u: Usage): Tokens {
  const [, pin, pout] = PRICES.find(([re]) => re.test(model)) ?? [null, 3, 15];
  const t = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cost: 0,
  };
  t.cost = (t.input * pin + t.output * pout + t.cacheWrite * pin * 1.25 + t.cacheRead * pin * 0.1) / 1e6;
  return t;
}

type Parsed = {
  byModel: Record<string, Tokens>;
  start: string | null;
  end: string | null;
  cwd: string | null;
  title: string | null;
  customTitle: string | null;
  firstPrompt: string | null;
  entrypoint: string | null;
};

/** One pass over a transcript. Streamed blocks repeat the same message.usage — count each message.id once. */
function parse(file: string): Parsed {
  const out: Parsed = { byModel: {}, start: null, end: null, cwd: null, title: null, customTitle: null, firstPrompt: null, entrypoint: null };
  const seen = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.timestamp) {
      out.start ??= e.timestamp;
      out.end = e.timestamp;
    }
    if (e.cwd) out.cwd ??= e.cwd;
    if (e.entrypoint) out.entrypoint ??= e.entrypoint;
    if (e.type === "ai-title" && e.aiTitle) out.title = e.aiTitle;
    if (e.type === "custom-title" && e.customTitle) out.customTitle = e.customTitle;
    if (e.type === "user" && !out.firstPrompt && !e.isMeta && !e.isSidechain) {
      const c = e.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.find((b: { type: string }) => b.type === "text")?.text : null;
      if (text && !text.startsWith("<")) out.firstPrompt = text.slice(0, 160);
    }
    if (e.type === "assistant" && e.message?.usage && e.message.model !== "<synthetic>") {
      const id = e.message.id ?? e.uuid;
      if (seen.has(id)) continue;
      seen.add(id);
      add((out.byModel[e.message.model] ??= zero()), price(e.message.model, e.message.usage));
    }
  }
  return out;
}

const cache = new Map<string, { mtime: number; parsed: Parsed }>();

function parsedCached(file: string, mtime: number): Parsed {
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.parsed;
  const parsed = parse(file);
  cache.set(file, { mtime, parsed });
  return parsed;
}

export type AgentRun = {
  agentId: string;
  type: string;
  description: string;
  models: string[];
  tokens: Tokens;
  start: string | null;
  end: string | null;
  active: boolean;
};

export type SessionUsage = {
  id: string;
  file: string;
  cwd: string | null;
  project: string;
  title: string;
  source: string; // cli | sdk-ts (agent-os) | ...
  start: string | null;
  end: string | null;
  active: boolean;
  main: Tokens;
  mainModels: string[];
  agents: AgentRun[];
  byModel: Record<string, Tokens>; // main + subagents
  total: Tokens;
};

const ACTIVE_MS = 90_000;

function projectOf(cwd: string | null): string {
  return cwd ? (projectOfPath(cwd) ?? path.basename(cwd)) : "?";
}

function sumModels(byModel: Record<string, Tokens>): Tokens {
  const t = zero();
  for (const v of Object.values(byModel)) add(t, v);
  return t;
}

function readSession(dir: string, file: string, mtime: number): SessionUsage {
  const id = file.replace(/\.jsonl$/, "");
  const p = parsedCached(path.join(dir, file), mtime);
  const agents: AgentRun[] = [];
  const subParsed: Record<string, Tokens>[] = [];
  const subDir = path.join(dir, id, "subagents");
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir).filter((f) => f.endsWith(".jsonl"))) {
      const full = path.join(subDir, f);
      const st = statSync(full);
      const sp = parsedCached(full, st.mtimeMs);
      subParsed.push(sp.byModel);
      let meta: { agentType?: string; description?: string } = {};
      try {
        meta = JSON.parse(readFileSync(full.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      } catch {}
      agents.push({
        agentId: f.replace(/^agent-|\.jsonl$/g, ""),
        type: meta.agentType ?? "subagent",
        description: meta.description ?? sp.firstPrompt ?? "",
        models: Object.keys(sp.byModel),
        tokens: sumModels(sp.byModel),
        start: sp.start,
        end: sp.end,
        active: Date.now() - st.mtimeMs < ACTIVE_MS,
      });
    }
  }
  agents.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  const main = sumModels(p.byModel);
  const byModel: Record<string, Tokens> = {};
  for (const src of [p.byModel, ...subParsed])
    for (const [m, t] of Object.entries(src)) add((byModel[m] ??= zero()), t);
  const total = sumModels(byModel);
  return {
    id,
    file: path.join(dir, file),
    cwd: p.cwd,
    project: projectOf(p.cwd),
    title: p.customTitle ?? p.title ?? p.firstPrompt ?? id.slice(0, 8),
    source: p.entrypoint ?? "?",
    start: p.start,
    end: p.end,
    active: Date.now() - mtime < ACTIVE_MS || agents.some((a) => a.active),
    main,
    mainModels: Object.keys(p.byModel),
    agents,
    byModel,
    total,
  };
}

/** Sessions touched in the last `days` days, newest first. */
export function listSessions(days = 7): SessionUsage[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  const since = Date.now() - days * 86_400_000;
  const out: SessionUsage[] = [];
  for (const d of readdirSync(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      const st = statSync(path.join(dir, f));
      const sub = path.join(dir, f.replace(/\.jsonl$/, ""), "subagents");
      const newest = existsSync(sub)
        ? Math.max(st.mtimeMs, ...readdirSync(sub).map((s) => statSync(path.join(sub, s)).mtimeMs))
        : st.mtimeMs;
      if (newest < since) continue;
      const s = readSession(dir, f, st.mtimeMs);
      if (s.total.cost > 0 || s.active) out.push(s);
    }
  }
  return out.sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
}

export type Bucket = { key: string; tokens: Tokens; count: number };

function bucket(map: Map<string, Bucket>, key: string, t: Tokens, n = 1) {
  const b = map.get(key) ?? { key, tokens: zero(), count: 0 };
  add(b.tokens, t);
  b.count += n;
  map.set(key, b);
}

export function usageSummary(days = 7) {
  const sessions = listSessions(days);
  const today = new Date().toLocaleDateString("sv-SE");
  const byProject = new Map<string, Bucket>();
  const byAgent = new Map<string, Bucket>();
  const byModel = new Map<string, Bucket>();
  const byDay = new Map<string, Bucket>();
  const total = zero();
  const todayTotal = zero();

  for (const s of sessions) {
    add(total, s.total);
    const day = s.end ? new Date(s.end).toLocaleDateString("sv-SE") : "?";
    if (day === today) add(todayTotal, s.total);
    bucket(byDay, day, s.total);
    bucket(byProject, s.project, s.total);
    bucket(byAgent, "main", s.main);
    for (const a of s.agents) bucket(byAgent, a.type, a.tokens);
    for (const [m, t] of Object.entries(s.byModel)) bucket(byModel, m, t);
  }

  const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.tokens.cost - a.tokens.cost);
  return {
    days,
    total,
    today: todayTotal,
    sessions: sessions.length,
    active: sessions.filter((s) => s.active).map((s) => s.id),
    byProject: sorted(byProject),
    byAgent: sorted(byAgent),
    byModel: sorted(byModel),
    byDay: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Transcript path for a session id, searching every project dir. */
export function findTranscript(id: string): string | null {
  if (!/^[0-9a-f-]{36}$/.test(id) || !existsSync(PROJECTS_DIR)) return null;
  for (const d of readdirSync(PROJECTS_DIR)) {
    const f = path.join(PROJECTS_DIR, d, `${id}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

type TranscriptEv =
  | { kind: "user"; text: string; skills: string[]; images: string[] }
  | { kind: "text"; text: string; sub: boolean }
  | { kind: "tool"; id: string; name: string; input: unknown; sub: boolean }
  | { kind: "tool_result"; id: string; text: string; isError: boolean };

/** The tail of a past conversation in the same event shape the tabs render. */
export function transcriptEvents(file: string, max = 80): TranscriptEv[] {
  const out: TranscriptEv[] = [];
  const seen = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain || e.isMeta) continue;
    const content = e.message?.content;
    if (e.type === "user") {
      if (typeof content === "string") {
        if (!content.startsWith("<")) out.push({ kind: "user", text: content, skills: [], images: [] });
      } else if (Array.isArray(content)) {
        const text = content.filter((b) => b.type === "text" && !String(b.text).startsWith("<")).map((b) => b.text).join("\n");
        const imgs = content.filter((b) => b.type === "image").length;
        if (text) out.push({ kind: "user", text: imgs ? `${text}\n[${imgs} imagen(es)]` : text, skills: [], images: [] });
        for (const b of content)
          if (b.type === "tool_result") {
            const t = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: { text?: string }) => x.text ?? "").join("\n") : "";
            out.push({ kind: "tool_result", id: b.tool_use_id, text: t.slice(0, 2000), isError: !!b.is_error });
          }
      }
    } else if (e.type === "assistant" && Array.isArray(content)) {
      for (const b of content) {
        const key = `${e.message.id}:${b.id ?? b.text?.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (b.type === "text" && b.text?.trim()) out.push({ kind: "text", text: b.text, sub: false });
        if (b.type === "tool_use") out.push({ kind: "tool", id: b.id, name: b.name, input: b.input, sub: false });
      }
    }
  }
  return out.slice(-max);
}

export type Summary = ReturnType<typeof usageSummary>;
