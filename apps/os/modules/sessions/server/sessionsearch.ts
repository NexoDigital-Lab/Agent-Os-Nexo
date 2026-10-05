// Full-text search over past Claude sessions: user + assistant text from ~/.claude/projects/*/*.jsonl into an
// SQLite FTS5 index (node:sqlite, no deps). Incremental per transcript (size+mtime), lazy, refreshed at most every 60 s.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { redact } from "../../../host/server/redact.ts";
import { projectOfPath } from "../../projects/server/projects.ts";

const MAX_TEXT = 2000;
const REFRESH_MS = 60_000;

export type SessionHit = { sessionId: string; project: string; title: string | null; at: string; role: string; snippet: string; hits: number };
export type AroundMsg = { role: string; at: string; text: string; match: boolean };

const projectOf = (cwd: string | null): string => (cwd ? (projectOfPath(cwd) ?? path.basename(cwd)) : "?");

type Msg = { role: "user" | "assistant"; at: string; text: string };
type Parsed = { cwd: string | null; title: string | null; msgs: Msg[] };

const clip = (s: string) => redact(s.trim()).slice(0, MAX_TEXT);

/** User/assistant text of one transcript; tool payloads are reduced to a "[tool: Name]" marker. */
export function parseTranscript(file: string): Parsed {
  const out: Parsed = { cwd: null, title: null, msgs: [] };
  let custom: string | null = null;
  let first: string | null = null;
  const seen = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.cwd) out.cwd ??= e.cwd;
    if (e.type === "ai-title" && e.aiTitle) out.title = e.aiTitle;
    if (e.type === "custom-title" && e.customTitle) custom = e.customTitle;
    if (e.isSidechain || e.isMeta) continue;
    const at: string = e.timestamp ?? "";
    const c = e.message?.content;
    if (e.type === "user") {
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
      if (!text.trim() || text.startsWith("<")) continue;
      first ??= text.slice(0, 160);
      out.msgs.push({ role: "user", at, text: clip(text) });
    } else if (e.type === "assistant" && Array.isArray(c)) {
      for (const b of c) {
        const key = `${e.message.id}:${b.id ?? b.text?.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (b.type === "text" && b.text?.trim()) out.msgs.push({ role: "assistant", at, text: clip(b.text) });
        else if (b.type === "tool_use" && b.name) out.msgs.push({ role: "assistant", at, text: `[tool: ${String(b.name).slice(0, 60)}]` });
      }
    }
  }
  out.title = custom ?? out.title ?? first;
  return out;
}

/** Turns free text into a safe FTS5 MATCH: every word quoted (AND), the last one a prefix. */
export function toMatch(q: string): string | null {
  const words = q.normalize("NFKC").split(/[^\p{L}\p{N}_]+/u).filter(Boolean).slice(0, 12);
  if (!words.length) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** FTS snippet() with \u0001/\u0002 as mark delimiters → everything escaped except <mark> tags. */
const markup = (s: string) => esc(s).replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>");

export function createIndex(opts: { dbPath: string; projectsDir?: string }) {
  const projectsDir = opts.projectsDir ?? path.join(os.homedir(), ".claude", "projects");
  if (opts.dbPath !== ":memory:") mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  const db = new DatabaseSync(opts.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, file TEXT, size INTEGER, mtime REAL, project TEXT, title TEXT);
    CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY, session_id TEXT, seq INTEGER, at TEXT, role TEXT);
    CREATE INDEX IF NOT EXISTS msgs_session ON msgs(session_id, seq);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, tokenize = 'unicode61 remove_diacritics 2');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_tri USING fts5(text, tokenize = 'trigram');
  `);
  const q = {
    known: db.prepare("SELECT id, size, mtime FROM sessions"),
    msgIds: db.prepare("SELECT id FROM msgs WHERE session_id = ?"),
    delFts: db.prepare("DELETE FROM fts WHERE rowid = ?"),
    delTri: db.prepare("DELETE FROM fts_tri WHERE rowid = ?"),
    delMsgs: db.prepare("DELETE FROM msgs WHERE session_id = ?"),
    delSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    putSession: db.prepare("INSERT OR REPLACE INTO sessions (id, file, size, mtime, project, title) VALUES (?, ?, ?, ?, ?, ?)"),
    putMsg: db.prepare("INSERT INTO msgs (session_id, seq, at, role) VALUES (?, ?, ?, ?) RETURNING id"),
    putFts: db.prepare("INSERT INTO fts (rowid, text) VALUES (?, ?)"),
    putTri: db.prepare("INSERT INTO fts_tri (rowid, text) VALUES (?, ?)"),
  };

  function drop(id: string) {
    for (const r of q.msgIds.all(id) as { id: number }[]) {
      q.delFts.run(r.id);
      q.delTri.run(r.id);
    }
    q.delMsgs.run(id);
    q.delSession.run(id);
  }

  function indexFile(id: string, file: string, size: number, mtime: number) {
    const p = parseTranscript(file);
    db.exec("BEGIN");
    try {
      drop(id);
      q.putSession.run(id, file, size, mtime, projectOf(p.cwd), p.title);
      p.msgs.forEach((m, seq) => {
        const { id: rid } = q.putMsg.get(id, seq, m.at, m.role) as { id: number };
        q.putFts.run(rid, m.text);
        q.putTri.run(rid, m.text);
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  let lastRun = 0;
  let running: Promise<void> | null = null;

  /** Reindexes new/changed transcripts, drops deleted ones. Yields to the event loop between files. */
  async function sync(): Promise<void> {
    const known = new Map((q.known.all() as { id: string; size: number; mtime: number }[]).map((r) => [r.id, r]));
    const present = new Set<string>();
    if (existsSync(projectsDir)) {
      for (const d of readdirSync(projectsDir)) {
        const dir = path.join(projectsDir, d);
        let files: string[];
        try {
          files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
        } catch {
          continue;
        }
        for (const f of files) {
          const id = f.slice(0, -6);
          const file = path.join(dir, f);
          let st;
          try {
            st = statSync(file);
          } catch {
            continue;
          }
          present.add(id);
          const k = known.get(id);
          if (k && k.size === st.size && k.mtime === st.mtimeMs) continue;
          try {
            indexFile(id, file, st.size, st.mtimeMs);
          } catch {}
          await new Promise((r) => setImmediate(r));
        }
      }
    }
    for (const id of known.keys()) if (!present.has(id)) drop(id);
  }

  /** Lazy + throttled: the first call builds, later ones refresh at most every 60 s (concurrent callers share one run). */
  function ensure(force = false): Promise<void> {
    if (running) return running;
    if (!force && lastRun && Date.now() - lastRun < REFRESH_MS) return Promise.resolve();
    running = sync().finally(() => {
      lastRun = Date.now();
      running = null;
    });
    return running;
  }

  function run(table: "fts" | "fts_tri", match: string, project: string | null, cap: number) {
    return db
      .prepare(
        `SELECT m.session_id AS sessionId, s.project, s.title, m.at, m.role, m.seq,
                snippet(${table}, 0, char(1), char(2), '…', 24) AS snip
         FROM ${table} JOIN msgs m ON m.id = ${table}.rowid JOIN sessions s ON s.id = m.session_id
         WHERE ${table} MATCH ? ${project ? "AND s.project = ?" : ""}
         ORDER BY rank LIMIT ?`,
      )
      .all(...(project ? [match, project, cap] : [match, cap])) as { sessionId: string; project: string; title: string | null; at: string; role: string; snip: string }[];
  }

  /** Best hit per session (by rank), with how many messages of that session matched. */
  async function search(query: string, o: { project?: string | null; limit?: number } = {}): Promise<SessionHit[]> {
    await ensure();
    const limit = Math.min(Math.max(o.limit ?? 20, 1), 50);
    const text = query.trim();
    const match = toMatch(text);
    if (!match) return [];
    const cap = limit * 15;
    let rows = run("fts", match, o.project ?? null, cap);
    if (!rows.length && text.length >= 3) rows = run("fts_tri", `"${text.replace(/"/g, '""')}"`, o.project ?? null, cap);
    const bySession = new Map<string, SessionHit>();
    for (const r of rows) {
      const hit = bySession.get(r.sessionId);
      if (hit) hit.hits++;
      else bySession.set(r.sessionId, { sessionId: r.sessionId, project: r.project, title: r.title, at: r.at, role: r.role, snippet: markup(r.snip), hits: 1 });
    }
    return [...bySession.values()].slice(0, limit);
  }

  /** The messages around the one at/closest to `at` (±n), to read a hit in context. */
  async function around(sessionId: string, at: string, n = 2): Promise<AroundMsg[]> {
    await ensure();
    const rows = db
      .prepare("SELECT m.seq, m.at, m.role, fts.text FROM msgs m JOIN fts ON fts.rowid = m.id WHERE m.session_id = ? ORDER BY m.seq")
      .all(sessionId) as { seq: number; at: string; role: string; text: string }[];
    if (!rows.length) return [];
    let best = 0;
    rows.forEach((r, i) => {
      if (r.at && r.at <= at) best = i;
    });
    const c = Math.min(Math.max(n, 0), 10);
    return rows.slice(Math.max(0, best - c), best + c + 1).map((r, i) => ({ role: r.role, at: r.at, text: r.text, match: r.seq === rows[best].seq }));
  }

  function stats() {
    const n = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    return { sessions: n("sessions"), messages: n("msgs") };
  }

  return { ensure, search, around, stats, close: () => db.close() };
}

let shared: ReturnType<typeof createIndex> | null = null;
let dbPath = "";

/** Where the index lives (.state/os/sessions/search.db: regenerable). Set once at register. */
export function setSearchDb(file: string): void {
  dbPath = file;
}

/** The app-wide index, opened on first use. */
export const sessionIndex = () => (shared ??= createIndex({ dbPath }));
