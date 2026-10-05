import { Pause, Square, Zap } from "lucide-react";
import { useState } from "react";
import { ktok } from "@os/lib/format";
import { sessionsApi as api, type TaskEv } from "./api";
import { t } from "@os/i18n";

const STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: "working", cls: "live" },
  pending: { label: "queued", cls: "warn" },
  paused: { label: "paused", cls: "warn" },
  completed: { label: "finished", cls: "done" },
  stopped: { label: "stopped", cls: "" },
  killed: { label: "stopped", cls: "" },
  failed: { label: "failed", cls: "bad" },
};

const secs = (ms?: number) => (ms ? (ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`) : "");

function QuickBox({ placeholder, onSend }: { placeholder: string; onSend: (t: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form
      className="quick"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setErr("");
        try {
          await onSend(text);
          setText("");
        } catch (x) {
          setErr(t((x as Error).message));
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="field" placeholder={placeholder} aria-label={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn sm primary" disabled={busy || !text.trim()}>{busy ? <span className="spin" /> : <Zap size={14} />}</button>
      {err && <div className="errline" style={{ gridColumn: "1 / -1" }}>{err}</div>}
    </form>
  );
}

/** Main agent + every subagent of this tab: live status, stop individually, quick prompt. */
export function Agents({
  tabId,
  tasks,
  running,
  activity,
  model,
  waitingPerm,
}: {
  tabId: string;
  tasks: TaskEv[];
  running: boolean;
  activity: string | null;
  model: string | null;
  waitingPerm: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const subs = tasks.filter((t) => t.type !== "local_bash");
  const bash = tasks.filter((t) => t.type === "local_bash");
  const mainState = !running ? t("idle") : waitingPerm ? t("waiting for your permission") : activity ? t("using {tool}", { tool: activity }) : t("thinking…");

  return (
    <div className="agents">
      <div className={`agent main ${running ? "on" : ""}`}>
        <div className="agent-head">
          <span className={`dot ${running ? (waitingPerm ? "warn" : "live") : ""}`} />
          <div className="agent-id">
            <b>{t("Main agent")}</b>
            <span className="faint mono">{model ?? ""}</span>
          </div>
          <span className="agent-state">{mainState}</span>
          {running && (
            <button className="btn sm danger" title={t("Stops the whole turn (main agent and subagents)")} onClick={() => api.interrupt(tabId)}>
              <Square size={14} /> {t("Stop")}
            </button>
          )}
        </div>
        <QuickBox
          placeholder={running ? t("Quick prompt: joins the current turn") : t("Quick prompt: starts a new turn")}
          onSend={(t) => api.quick(tabId, t)}
        />
      </div>

      <div className="eyebrow" style={{ margin: "14px 2px 8px" }}>
        {t("Subagents · {active} active / {total}", { active: subs.filter((s) => s.status === "running").length, total: subs.length })}
      </div>
      {subs.length === 0 && <div className="faint" style={{ fontSize: 13, padding: "4px 2px" }}>{t("No subagents in this tab yet.")}</div>}
      {[...subs].reverse().map((task) => {
        const st = STATUS[task.status] ?? { label: task.status, cls: "" };
        const isRunning = task.status === "running";
        return (
          <div key={task.id} className={`agent ${isRunning ? "on" : ""}`}>
            <div className="agent-head">
              <span className={`dot ${st.cls}`} />
              <div className="agent-id">
                <b className="mono ty">{task.type}</b>
                <span className="desc" title={task.description}>{task.description}</span>
              </div>
              <span className={`agent-state ${st.cls}`}>{t(st.label)}</span>
              {isRunning && (
                <button
                  className="btn sm"
                  title={t("Stops only this subagent. The SDK can't resume it: to continue, send it a quick prompt and the main agent relaunches it.")}
                  onClick={() => api.stopTask(tabId, task.id)}
                >
                  <Pause size={14} /> {t("Stop")}
                </button>
              )}
              <button className="btn sm ghost" title={t("Quick prompt to this subagent")} aria-label={t("Quick prompt to this subagent")} onClick={() => setOpen(open === task.id ? null : task.id)}>
                <Zap size={14} />
              </button>
            </div>
            <div className="agent-stats mono">
              {task.tokens ? <span>{ktok(task.tokens)} tok</span> : null}
              {task.tools ? <span>{task.tools} tools</span> : null}
              {task.ms ? <span>{secs(task.ms)}</span> : null}
              {task.lastTool ? <span>{t("last: {tool}", { tool: task.lastTool })}</span> : null}
            </div>
            {isRunning && task.now && task.now !== task.description && <div className="agent-now">↳ {task.now}</div>}
            {!isRunning && task.summary && task.summary !== task.description && <div className="agent-now">{task.summary.slice(0, 220)}</div>}
            {open === task.id && (
              <QuickBox
                placeholder={isRunning ? t("I stop it and the main agent relaunches it with this…") : t("The main agent picks up its work with this…")}
                onSend={async (txt) => {
                  await api.quick(tabId, txt, task.id);
                  setOpen(null);
                }}
              />
            )}
          </div>
        );
      })}

      {bash.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "14px 2px 8px" }}>{t("Background commands")}</div>
          {[...bash].reverse().map((task) => {
            const st = STATUS[task.status] ?? { label: task.status, cls: "" };
            return (
              <div key={task.id} className="agent bash">
                <div className="agent-head">
                  <span className={`dot ${st.cls}`} />
                  <span className="desc mono" title={task.description}>{task.description}</span>
                  <span className={`agent-state ${st.cls}`}>{t(st.label)}</span>
                  {task.status === "running" && (
                    <button className="btn sm" onClick={() => api.stopTask(tabId, task.id)} aria-label={t("Stop")}><Square size={14} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
