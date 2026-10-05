// Bottom drawer of the Docker view: container logs, or shells opened inside containers (server-side, so they survive view switches).
import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { t } from "@os/i18n";
import { Terminal } from "../../editor/submodules/terminal/web/Terminal";
import { dockerApi as api, type TermInfo } from "./api";

export type Drawer = { mode: "logs"; id: string; name: string } | { mode: "shell" };

export function DockerDrawer({ drawer, setDrawer, terms, active, setActive, closeTerm, fail }: {
  drawer: Drawer;
  setDrawer: (d: Drawer | null) => void;
  terms: TermInfo[];
  active: string | null;
  setActive: (id: string) => void;
  closeTerm: (id: string) => void;
  fail: (msg: string) => void;
}) {
  return (
    <div className="panel dk-drawer">
      <div className="panel-head">
        <div className="panel-tabs">
          {drawer.mode === "logs" && <button className="on">Logs · <span className="mono">{drawer.name}</span></button>}
          {drawer.mode === "shell" && <button className="on">{t("Terminals")}{terms.length > 1 ? ` · ${terms.length}` : ""}</button>}
        </div>
        {drawer.mode === "shell" && (
          <div className="term-list">
            {terms.map((term) => (
              <span key={term.id} className={`term-chip ${active === term.id ? "on" : ""}`} role="button" tabIndex={0} aria-pressed={active === term.id} onClick={() => setActive(term.id)} onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setActive(term.id))} title={term.title}>
                {term.title}
                <button title={t("Close this terminal (kills the process)")} aria-label={t("Close the terminal {title}", { title: term.title })} onClick={(e) => (e.stopPropagation(), closeTerm(term.id))}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <span style={{ flex: 1 }} />
        <button className="panel-x" title={t("Close")} aria-label={t("Close the panel")} onClick={() => setDrawer(null)}><X size={14} /></button>
      </div>
      {drawer.mode === "logs" ? (
        <Logs id={drawer.id} fail={fail} />
      ) : (
        <div className="panel-body">
          {terms.length === 0 && <div className="faint" style={{ padding: 12, fontSize: 13 }}>{t("No terminals. Open one from a running container.")}</div>}
          {terms.map((term) => (
            <div key={term.id} className="term-pane" style={{ display: active === term.id ? "block" : "none" }}>
              <Terminal tabId="docker" termId={term.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Logs({ id, fail }: { id: string; fail: (msg: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pre = useRef<HTMLPreElement>(null);

  const load = () => {
    setLoading(true);
    return api.containerLogs(id).then((r) => setText(r.text), (e) => fail(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => {
    setText(null);
    let live = true;
    api.containerLogs(id).then((r) => live && setText(r.text), (e) => live && fail(e.message));
    return () => { live = false; };
  }, [id]);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [text]);

  return (
    <div className="panel-body dk-logs">
      <button className="btn sm ghost dk-logs-refresh" title={t("Reload logs")} aria-label={t("Reload logs")} disabled={loading} onClick={load}>
        {loading ? <span className="spin" /> : <RefreshCw size={14} />}
      </button>
      <pre ref={pre} className="mono">{text === null ? t("Loading…") : text || t("(no output)")}</pre>
    </div>
  );
}
