// The conversation of a tab: your messages, Claude's text, tool calls with their results, permission prompts,
// and the end-of-turn summary.
import { ArrowDown, RefreshCw, TriangleAlert, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderMarkdown } from "@os/lib/markdown";
import { usd } from "@os/lib/format";
import { slot } from "@os/registry";
import { sessionsApi as api, type Ev, type Tab } from "../api";
import type { ChatEventRenderer } from "../slots";
import type { TabStream } from "./useTabStream";
import { t } from "@os/i18n";

function toolArg(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const v = i.file_path ?? i.command ?? i.pattern ?? i.skill ?? i.description ?? i.url ?? i.query;
  return typeof v === "string" ? v : JSON.stringify(input).slice(0, 120);
}

type ModuleEv = Extract<Ev, { kind: "module" }>;

export function ChatLog({ tab, stream }: { tab: Tab; stream: TabStream }) {
  const { events, results, permDone, running, pendingPerms } = stream;
  // Module events (e.g. SSH plans) are re-emitted as they change: show the latest per id, where the first one was.
  const renderers = slot<ChatEventRenderer>("chat.events");
  const latest = new Map<string, ModuleEv>();
  for (const e of events) if (e.kind === "module") latest.set(`${e.module}:${e.id}`, e);
  const shown = new Set<string>();
  const ref = useRef<HTMLDivElement>(null);

  // Chat scroll: opens at the bottom, follows new output only while you are near it, and offers a jump-down
  // button (with a count of what arrived meanwhile) once you have scrolled up.
  const stick = useRef(true);
  const seen = useRef(0);
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(0);
  const toBottom = (smooth = false) => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setAway(false);
    setUnread(0);
  };
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = d < 120;
    setAway(d > 200);
    if (d < 120) setUnread(0);
  };
  // Mounting (opening a session, coming back to Chat) lands on the latest message, before first paint.
  useLayoutEffect(() => {
    toBottom();
    seen.current = events.length;
  }, [tab.id]);
  useLayoutEffect(() => {
    const grew = events.slice(seen.current).filter((e) => ["user", "text", "tool", "perm", "module", "result", "error"].includes(e.kind)).length;
    seen.current = events.length;
    if (stick.current) toBottom();
    else if (grew) setUnread((n) => n + grew);
  }, [events]);
  // Late layout (markdown, images, the history swap after a reconnect) must not strand an opened session mid-way.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [events.length]);

  return (
    <div className="stream-wrap">
    <div className="stream" ref={ref} onScroll={onScroll}>
      {events.length === 0 && (
        <div className="empty">
          <div className="eyebrow">{tab.project}</div>
          <p>{t("Write the task. First I recommend skills, you choose, and only then the agent runs.")}</p>
        </div>
      )}
      {events.map((e, i) => {
        switch (e.kind) {
          case "user":
            return (
              <div key={i} className={`msg-user ${e.quick ? "quick-msg" : ""}`}>
                {e.quick && <div className="quick-tag"><Zap size={12} /> {t("quick → {target}", { target: t(e.quick) })}</div>}
                {e.images && e.images.length > 0 && (
                  <div className="thumbs">
                    {e.images.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" /></a>
                    ))}
                  </div>
                )}
                {e.text}
                {e.skills.length > 0 && (
                  <div className="sk">
                    {e.skills.map((s) => (
                      <span key={s} className="pill accent">{s}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          case "init":
            return (
              <div key={i} className="result">
                <span className="pill info">{e.model}</span>
                <span>{t("mode {mode}", { mode: e.mode })}</span>
              </div>
            );
          case "text":
            return (
              <div key={i} className={`msg-text ${e.sub ? "sub" : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(e.text) }} />
            );
          case "tool": {
            const r = results.get(e.id);
            return (
              <details key={i} className={`tool ${e.sub ? "sub" : ""} ${r?.isError ? "err" : ""}`}>
                <summary>
                  {!r ? <span className="spin" /> : <span className={`dot ${r.isError ? "" : "warn"}`} style={r.isError ? { background: "var(--bad)" } : {}} />}
                  <span className="tn">{e.name}</span>
                  <span className="ta">{toolArg(e.input)}</span>
                </summary>
                <pre>{JSON.stringify(e.input, null, 2)}</pre>
                {r && <pre>{r.text}</pre>}
              </details>
            );
          }
          case "perm": {
            const done = permDone.get(e.id);
            return (
              <div key={i} className="perm">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>
                    {t("The agent wants to use")} <b className="mono">{e.tool}</b>
                  </span>
                  {done !== undefined && <span className={`pill ${done ? "ok" : "bad"}`}>{done ? t("approved") : t("denied")}</span>}
                </div>
                <pre>{toolArg(e.input)}</pre>
                {done === undefined && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn primary sm" onClick={() => api.permission(tab.id, e.id, true)}>{t("Allow")}</button>
                    {e.always && (
                      <button
                        className="btn sm"
                        title={t("Saves {rules} in {where}: it won't ask about this again", { rules: e.always.rules.join(", "), where: t(e.always.where) })}
                        onClick={() => api.permission(tab.id, e.id, true, true)}
                      >
                        {t("Always allow")} <span className="mono faint">{e.always.rules.join(", ")}</span>
                      </button>
                    )}
                    <button className="btn sm danger" onClick={() => api.permission(tab.id, e.id, false)}>{t("Deny")}</button>
                  </div>
                )}
              </div>
            );
          }
          case "module": {
            const key = `${e.module}:${e.id}`;
            const R = renderers.find((r) => r.module === e.module && r.type === e.type);
            if (!R || shown.has(key)) return null;
            shown.add(key);
            return <R.component key={i} tab={tab} ev={latest.get(key)!} />;
          }
          case "result":
            return (
              <div key={i} className="result">
                <span className={`pill ${e.ok ? "ok" : "bad"}`}>{e.ok ? t("done") : t("error")}</span>
                <span>{t("{cost} session", { cost: usd(e.cost) })}</span>
                <span>{t("{n} turns", { n: e.turns })}</span>
                <span>{(e.ms / 1000).toFixed(1)}s</span>
              </div>
            );
          case "error":
            return <div key={i} className="errline"><TriangleAlert size={14} /> {e.text}</div>;
          case "note":
            return <div key={i} className="note"><RefreshCw size={14} /> {t(e.text)}</div>;
          default:
            return null;
        }
      })}
      {running && (
        <div className="faint" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <span className="spin" /> {pendingPerms ? t("waiting for your permission…") : t("working…")}
        </div>
      )}
    </div>
    {away && (
      <button className="to-bottom" onClick={() => toBottom(true)} aria-label={unread ? t("Jump to the end, {n} new messages", { n: unread }) : t("Jump to the end")} title={t("Jump to the end")}>
        <ArrowDown size={16} />
        {unread > 0 && <span className="to-bottom-n" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
    )}
    </div>
  );
}
