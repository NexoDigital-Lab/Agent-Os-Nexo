// Gemini CLI persists no token or cost data on disk — only the conversation itself. The adapter
// lists its chat sessions (tmp/<project>/chats/session-*.jsonl) with zeroed tokens and
// usageAvailable = false, so the monitor shows the sessions without inventing spend numbers.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionUsage } from "./usage.ts";

const ACTIVE_MS = 90_000; // same live window as usage.ts

function tmpRoot(): string {
  return path.join(os.homedir(), ".gemini", "tmp");
}

type Meta = { sessionId?: string; startTime?: string; lastUpdated?: string };

/** Gemini sessions touched in the last `days` days, newest first. Missing directory -> empty. */
export function listGeminiSessions(days = 7): SessionUsage[] {
  const root = tmpRoot();
  if (!existsSync(root)) return [];
  const since = Date.now() - days * 86_400_000;
  const zero = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 });
  const out: SessionUsage[] = [];
  for (const d of readdirSync(root)) {
    const dir = path.join(root, d);
    if (!statSync(dir).isDirectory()) continue;
    let project = d;
    try {
      project = readFileSync(path.join(dir, ".project_root"), "utf8").trim() || d;
      project = path.basename(project);
    } catch {}
    const chats = path.join(dir, "chats");
    if (!existsSync(chats)) continue;
    for (const f of readdirSync(chats)) {
      if (!f.startsWith("session-") || !f.endsWith(".jsonl")) continue;
      const file = path.join(chats, f);
      const mtime = statSync(file).mtimeMs;
      if (mtime < since) continue;
      let meta: Meta = {};
      let title: string | null = null;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.sessionId) meta = e;
        if (!title && Array.isArray(e.$set?.messages)) {
          for (const m of e.$set.messages)
            if (m.type === "user") {
              const text = (m.content ?? []).map((b: { text?: string }) => b.text ?? "").join("\n").trim();
              if (text && !text.startsWith("<")) {
                title = text.slice(0, 160);
                break;
              }
            }
        }
      }
      const mtimeIso = new Date(mtime).toISOString();
      const end = meta.lastUpdated && meta.lastUpdated > mtimeIso ? meta.lastUpdated : mtimeIso;
      out.push({
        id: meta.sessionId ?? f.replace(/^session-|\.jsonl$/g, ""),
        provider: "gemini",
        file,
        cwd: null,
        project,
        title: title ?? (meta.sessionId ?? f).slice(0, 8),
        source: "gemini",
        start: meta.startTime ?? mtimeIso,
        end,
        active: Date.now() - mtime < ACTIVE_MS,
        usageAvailable: false, // the CLI stores no tokens or cost: sessions only
        main: zero(),
        mainModels: [],
        agents: [],
        byModel: {},
        total: zero(),
      });
    }
  }
  return out.sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""));
}
