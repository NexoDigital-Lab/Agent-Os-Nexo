// OpenCode v2 keeps per-session usage aggregates in its SQLite store: table `session_v2` carries
// cost (USD), token counts, agent, model and the parent link used for subagents. Read-only.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import type { AgentRun, SessionUsage, Tokens } from "./usage.ts";

const ACTIVE_MS = 90_000; // same live window as usage.ts

// OpenCode honors XDG_DATA_HOME on POSIX and falls back to ~/.local/share.
function dbPath(): string {
  const data = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(data, "opencode", "opencode.db");
}

type Row = {
  id: string;
  parent_id: string | null;
  title: string | null;
  directory: string | null;
  cost: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  agent: string | null;
  model: string | null;
  time_created: number | null;
  time_updated: number | null;
};

const zero = (): Tokens => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 });

function tokensOf(r: Row): Tokens {
  return {
    input: r.tokens_input ?? 0,
    output: r.tokens_output ?? 0,
    cacheWrite: r.tokens_cache_write ?? 0,
    cacheRead: r.tokens_cache_read ?? 0,
    cost: r.cost ?? 0,
  };
}

function modelId(model: string | null): string {
  if (!model) return "?";
  try {
    return JSON.parse(model).id ?? model;
  } catch {
    return model;
  }
}

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

/** OpenCode sessions touched in the last `days` days, newest first. Missing or broken store -> empty. */
export function listOpencodeSessions(days = 7): SessionUsage[] {
  const file = dbPath();
  if (!existsSync(file)) return [];
  let rows: Row[];
  try {
    // node:sqlite ships with Node >= 22.5; open read-only and tolerate any schema drift.
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      rows = db
        .prepare(
          `SELECT id, parent_id, title, directory, cost, tokens_input, tokens_output, tokens_cache_read,
                  tokens_cache_write, agent, model, time_created, time_updated
           FROM session_v2 WHERE time_updated >= ?`,
        )
        .all(Date.now() - days * 86_400_000) as Row[];
    } finally {
      db.close();
    }
  } catch {
    return []; // corrupt store, older schema without session_v2, sqlite unavailable...
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: SessionUsage[] = [];
  for (const r of rows) {
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (r.parent_id && parent) continue; // attached to its parent below as an AgentRun
    const children = rows.filter((c) => c.parent_id === r.id);
    const agents: AgentRun[] = children.map((c) => ({
      agentId: c.id,
      type: c.agent ?? "subagent",
      description: c.title ?? "",
      models: [modelId(c.model)],
      tokens: tokensOf(c),
      start: iso(c.time_created),
      end: iso(c.time_updated),
      active: c.time_updated != null && Date.now() - c.time_updated < ACTIVE_MS,
    }));
    const byModel: Record<string, Tokens> = {};
    const own = modelId(r.model);
    byModel[own] = tokensOf(r);
    for (const c of children) {
      const m = modelId(c.model);
      const t = tokensOf(c);
      const slot = (byModel[m] ??= zero());
      slot.input += t.input;
      slot.output += t.output;
      slot.cacheWrite += t.cacheWrite;
      slot.cacheRead += t.cacheRead;
      slot.cost += t.cost;
    }
    const total = zero();
    for (const t of Object.values(byModel)) {
      total.input += t.input;
      total.output += t.output;
      total.cacheWrite += t.cacheWrite;
      total.cacheRead += t.cacheRead;
      total.cost += t.cost;
    }
    const updated = r.time_updated ?? 0;
    const s: SessionUsage = {
      id: r.id,
      provider: "opencode",
      file,
      cwd: r.directory,
      project: r.directory ? path.basename(r.directory) : "?",
      title: r.title ?? r.id,
      source: "opencode",
      start: iso(r.time_created),
      end: iso(r.time_updated),
      active: r.time_updated != null && Date.now() - updated < ACTIVE_MS,
      usageAvailable: true,
      main: tokensOf(r),
      mainModels: [own],
      agents,
      byModel,
      total,
    };
    if (s.total.cost > 0 || s.active) out.push(s);
  }
  return out.sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
}
