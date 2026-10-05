import { Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { locale } from "@os/i18n";
import type { HistoryItem } from "../api";
import { t } from "@os/i18n";

export type SessionHit = { sessionId: string; project: string; title: string | null; at: string; role: string; snippet: string; hits: number };

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The server escapes everything but <mark>…</mark>; split on those tags and render plain text nodes (no innerHTML). */
export function Snippet({ html }: { html: string }) {
  const parts = html.split(/(<mark>|<\/mark>)/);
  let on = false;
  return (
    <>
      {parts.map((p, i) => {
        if (p === "<mark>") return ((on = true), null);
        if (p === "</mark>") return ((on = false), null);
        return on ? <mark key={i}>{decode(p)}</mark> : <span key={i}>{decode(p)}</span>;
      })}
    </>
  );
}

async function searchSessions(q: string, signal: AbortSignal): Promise<SessionHit[]> {
  const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(q)}&limit=20`, { credentials: "same-origin", signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
};

/** Search box + results over past sessions; with an empty query it shows `children` (the recents list). */
export function SessionSearch({ onResume, children }: { onResume: (h: HistoryItem) => void; children: ReactNode }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SessionHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits(null);
      setErr(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      searchSessions(term, ctl.signal)
        .then((r) => (setHits(r), setErr(null)))
        .catch((e) => {
          if (e.name !== "AbortError") setErr(e.message || t("Search failed"));
        })
        .finally(() => !ctl.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [q]);

  // The same action the recents list uses: onResume takes a HistoryItem and only needs its id.
  const open = (h: SessionHit) =>
    onResume({ id: h.sessionId, title: h.title ?? "", project: h.project, cwd: null, source: "cli", start: null, end: h.at, active: false, cost: 0, agents: 0, tabId: null });

  return (
    <>
      <div className="ss-box">
        <Search size={14} />
        <input
          className="field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQ("")}
          placeholder={t("Search every past session…")}
          aria-label={t("Search sessions")}
        />
        {q && (
          <button className="btn sm ghost" onClick={() => setQ("")} title={t("Clear search")} aria-label={t("Clear search")}>
            <X size={14} />
          </button>
        )}
      </div>
      {!q.trim() ? (
        children
      ) : err ? (
        <div className="ss-state err">{t("Search failed: {error}", { error: err })}</div>
      ) : loading && !hits ? (
        <div className="ss-state">{t("Searching… the first time it indexes your sessions and may take a few seconds.")}</div>
      ) : hits && !hits.length ? (
        <div className="ss-state">{t("No results for “{q}”.", { q: q.trim() })}</div>
      ) : (
        <div className={`hist ss-list ${loading ? "busy" : ""}`}>
          {hits?.map((h) => (
            <button key={h.sessionId} className="hist-row ss-row" onClick={() => open(h)} title={t("Resume this session")}>
              <span className="dot" />
              <span className="hist-main">
                <span className="hist-title">{h.title || h.sessionId.slice(0, 8)}</span>
                <span className="hist-meta">
                  {h.project} · {fmtDate(h.at)} · {h.role === "user" ? t("you") : t("agent")}
                  {h.hits > 1 ? ` · ${t("{n} matches", { n: h.hits })}` : ""}
                </span>
                <span className="ss-snip">
                  <Snippet html={h.snippet} />
                </span>
              </span>
              <span />
              <span className="hist-go" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
