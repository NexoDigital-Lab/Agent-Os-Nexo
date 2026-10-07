import { useEffect, useState } from "react";
import { ago, ktok, shortModel, usd } from "@os/lib/format";
import { monitorApi as api, type Bucket, type SessionUsage, type Summary } from "./api";
import { t } from "@os/i18n";

function Bars({ items, label }: { items: Bucket[]; label?: (b: Bucket) => string }) {
  const max = Math.max(...items.map((b) => b.tokens.cost), 0.0001);
  return (
    <div className="bars">
      {items.slice(0, 8).map((b) => (
        <div key={b.key} className="bar">
          <div className="top">
            <span className="k mono">{label ? label(b) : b.key}</span>
            <span className="num muted">
              {usd(b.tokens.cost)} <span className="faint">· {ktok(b.tokens.output)} out</span>
            </span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${(b.tokens.cost / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {items.length === 0 && <div className="faint">{t("No data")}</div>}
    </div>
  );
}

export function Monitor() {
  const [days, setDays] = useState(7);
  const [sum, setSum] = useState<Summary | null>(null);
  const [sessions, setSessions] = useState<SessionUsage[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([api.summary(days), api.sessions(days)]).then(([s, l]) => {
        if (!alive) return;
        setSum(s);
        setSessions(l);
      });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [days]);

  if (!sum) return <div className="page"><span className="spin" /></div>;

  const active = sessions.filter((s) => s.active);
  const subagents = sessions.reduce((n, s) => n + s.agents.length, 0);
  const shown = sessions.filter((s) => !filter || s.project === filter);
  const maxDay = Math.max(...sum.byDay.map((d) => d.tokens.cost), 0.0001);

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1>Monitor</h1>
          <p className="sub">{t("Every Claude Code session (terminal and agent-os-nexo) with its subagents, read from the transcripts.")}</p>
        </div>
        <div className="seg">
          {[1, 7, 30].map((d) => (
            <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>
              {d === 1 ? t("Today") : t("{n} days", { n: d })}
            </button>
          ))}
        </div>
      </div>

      {active.length > 0 && (
        <div className="active-banner">
          {active.map((s) => {
            const runningAgents = s.agents.filter((a) => a.active);
            return (
              <div key={s.id} className="active-item">
                <span className="dot live" />
                <b>{s.project}</b>
                <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                {runningAgents.map((a) => (
                  <span key={a.agentId} className="pill info">{a.type}</span>
                ))}
                <span className="num accent" style={{ color: "var(--accent-text)" }}>{usd(s.total.cost)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <div className="eyebrow">{t("Today")}</div>
          <div className="v accent">{usd(sum.today.cost)}</div>
          <div className="d">{t("{n} output tokens", { n: ktok(sum.today.output) })}</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">{days === 1 ? t("Period") : t("{n} days", { n: days })}</div>
          <div className="v">{usd(sum.total.cost)}</div>
          <div className="d">{ktok(sum.total.input + sum.total.cacheRead + sum.total.cacheWrite)} in · {ktok(sum.total.output)} out</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">{t("Sessions")}</div>
          <div className="v">{sum.sessions}</div>
          <div className="d">{t("{n} live now", { n: active.length })}</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">{t("Subagents")}</div>
          <div className="v">{subagents}</div>
          <div className="d">{t("{n} different types", { n: sum.byAgent.filter((b) => b.key !== "main").length })}</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">{t("Cache hit")}</div>
          <div className="v">
            {Math.round((sum.total.cacheRead / Math.max(1, sum.total.cacheRead + sum.total.cacheWrite + sum.total.input)) * 100)}%
          </div>
          <div className="d">{t("of the input comes from cache")}</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="eyebrow">{t("By agent")}</div>
          <Bars items={sum.byAgent} label={(b) => (b.key === "main" ? `main · ${t("{n} sess.", { n: b.count })}` : `${b.key} · ×${b.count}`)} />
        </div>
        <div className="card">
          <div className="eyebrow">{t("By model")}</div>
          <Bars items={sum.byModel} label={(b) => shortModel(b.key)} />
        </div>
        <div className="card">
          <div className="eyebrow">{t("By project")}</div>
          <Bars items={sum.byProject} />
        </div>
      </div>

      {sum.byDay.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="eyebrow">{t("Cost per day")}</div>
          <div className="days">
            {sum.byDay.map((d) => (
              <div key={d.key} className="col" title={`${d.key}: ${usd(d.tokens.cost)}`}>
                <span className="num faint" style={{ fontSize: 10.5 }}>{usd(d.tokens.cost)}</span>
                <div className="b" style={{ height: `${(d.tokens.cost / maxDay) * 80}%` }} />
                <span className="lbl">{d.key.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "22px 0 10px" }}>
        <div className="eyebrow">{t("Sessions → subagents")}</div>
        <select className="field" aria-label={t("Project")} style={{ width: "auto", padding: "4px 26px 4px 8px", fontSize: 12.5 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">{t("All projects")}</option>
          {sum.byProject.map((b) => <option key={b.key} value={b.key}>{b.key}</option>)}
        </select>
      </div>
      {shown.map((s) => (
        <details key={s.id} className="sess" open={s.active}>
          <summary>
            <span className={`dot ${s.active ? "live" : ""}`} />
            <span className="title">
              <b>{s.project}</b> <span className="muted">· {s.title}</span>
            </span>
            <span className="mono faint" style={{ fontSize: 12 }}>
              {s.source === "cli" ? t("terminal") : s.source.startsWith("sdk") ? "agent-os-nexo" : s.source} · {ago(s.end)}
            </span>
            <span className="mono faint" style={{ fontSize: 12 }}>{t("{n} subagents", { n: s.agents.length })}</span>
            <span className="num muted" style={{ fontSize: 12.5 }}>{ktok(s.total.output)} out</span>
            <span className="num" style={{ color: "var(--accent-text)", textAlign: "right" }}>{usd(s.total.cost)}</span>
          </summary>
          <div className="tree">
            <div className="node">
              <span className="dot warn" />
              <span className="ty" style={{ color: "var(--accent-text)" }}>main</span>
              <span className="ds">{s.mainModels.map(shortModel).join(", ")}</span>
              <span className="num faint">{ktok(s.main.input + s.main.cacheRead + s.main.cacheWrite)} in</span>
              <span className="num muted">{ktok(s.main.output)} out</span>
              <span className="num">{usd(s.main.cost)}</span>
            </div>
            {s.agents.map((a) => (
              <div key={a.agentId} className="node">
                <span className={`dot ${a.active ? "live" : ""}`} />
                <span className="ty">{a.type}</span>
                <span className="ds" title={a.description}>
                  {a.description} <span className="faint">· {a.models.map(shortModel).join(", ")}</span>
                </span>
                <span className="num faint">{ktok(a.tokens.input + a.tokens.cacheRead + a.tokens.cacheWrite)} in</span>
                <span className="num muted">{ktok(a.tokens.output)} out</span>
                <span className="num">{usd(a.tokens.cost)}</span>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
