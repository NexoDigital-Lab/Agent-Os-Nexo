import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { locale } from "@os/i18n";
import { usd } from "@os/lib/format";
import { call, hostApi } from "@os/lib/http";
import { renderMarkdown } from "@os/lib/markdown";
import { openDeleteProject, openNewProject } from "../../projects/web/events";
import { useProjects } from "../../projects/web/store";
import { sessionsApi, type HistoryItem } from "../../sessions/web/api";
import { History } from "../../sessions/web/History";
import { SessionSearch } from "../../sessions/web/search/SessionSearch";
import { openTab } from "../../sessions/web/tabs/store";
import { resumeSession } from "../../sessions/web/Workspace";
import { t } from "@os/i18n";

type Doc = "inbox" | "goals" | "log";
const homeApi = {
  doc: (doc: Doc) => call<{ text: string; todayCost: number }>("GET", `/api/home/${doc}`),
  saveDoc: (doc: "inbox" | "goals", text: string) => call("PUT", `/api/home/${doc}`, { text }),
  inbox: (text: string, project: string | null) => call("POST", "/api/home/inbox", { text, project }),
};

export function Home() {
  const projects = useProjects();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [user, setUser] = useState<string | null>(null);
  const onResume = (h: HistoryItem) => void resumeSession(h);
  const [goals, setGoals] = useState("");
  const [goalsEdit, setGoalsEdit] = useState(false);
  const [inbox, setInbox] = useState("");
  const [log, setLog] = useState("");
  const [cost, setCost] = useState(0);
  const [capture, setCapture] = useState("");

  const load = () => {
    void homeApi.doc("goals").then((r) => setGoals(r.text), () => {});
    void homeApi.doc("inbox").then((r) => setInbox(r.text), () => {});
    void homeApi.doc("log").then((r) => {
      setLog(r.text);
      setCost(r.todayCost);
    }, () => {});
  };
  useEffect(() => {
    load();
    void hostApi.info().then((i) => setUser(i.user), () => {});
    const loadHistory = () => void sessionsApi.history(10).then(setHistory, () => {});
    loadHistory();
    const id = setInterval(loadHistory, 5000);
    return () => clearInterval(id);
  }, []);

  const hour = new Date().getHours();
  const hello = hour < 13 ? t("Good morning") : hour < 20 ? t("Good afternoon") : t("Good evening");

  return (
    <div className="page">
      <h1>{user ? `${hello}, ${user.split(" ")[0]}` : hello}</h1>
      <p className="sub">
        {new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })} ·{" "}
        {t("today you've spent")} <span className="num" style={{ color: "var(--accent-text)" }}>{usd(cost)}</span> {t("from agent-os")}
      </p>

      <div className="eyebrow" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
        {t("Projects")}
        <button className="btn sm ghost" onClick={openNewProject}><Plus size={14} /> {t("New project")}</button>
      </div>
      <div className="pgrid" style={{ marginBottom: 22 }}>
        {projects.length === 0 && <div className="faint">{t("No projects yet. Create one or clone one of yours.")}</div>}
        {projects.map((p) => (
          <div key={p.id} className="pcard" role="button" tabIndex={0} onClick={() => p.path && void openTab(p.id)} onKeyDown={(e) => e.key === "Enter" && p.path && void openTab(p.id)}>
            <div className="n">
              <span>{p.workspace && <span className="faint">{p.workspace} / </span>}{p.name}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {p.changed > 0 && <span className="pill accent">{t("{n} changes", { n: p.changed })}</span>}
                <button className="del-proj" title={t("Delete {name}…", { name: p.id })} aria-label={t("Delete {name}…", { name: p.id })} onClick={(e) => { e.stopPropagation(); openDeleteProject(p.id); }}><Trash2 size={14} /></button>
              </span>
            </div>
            <div className="m">
              <span style={{ color: "var(--violet)" }}>{p.branch || t("no code/ yet")}</span> · {t("{n} features", { n: p.features.length })}
            </div>
            <div className="c">{p.lastCommit ? `${p.lastCommit.subject} · ${p.lastCommit.when}` : t("no commits")}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="eyebrow">{t("Recent sessions")}</div>
          <span className="faint" style={{ fontSize: 12 }}>
            <span className="dot live" style={{ marginRight: 6 }} />{t("live now · click to resume")}
          </span>
        </div>
        <SessionSearch onResume={onResume}>
          <History items={history} onResume={onResume} />
        </SessionSearch>
      </div>

      <div className="home">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="eyebrow">{t("Goals")}</div>
            <button
              className="btn sm ghost"
              onClick={async () => {
                if (goalsEdit) await homeApi.saveDoc("goals", goals);
                setGoalsEdit(!goalsEdit);
              }}
            >
              {goalsEdit ? t("Save") : t("Edit")}
            </button>
          </div>
          {goalsEdit ? (
            <textarea className="field" aria-label={t("Goals")} style={{ marginTop: 10 }} value={goals} onChange={(e) => setGoals(e.target.value)} />
          ) : goals ? (
            <div className="md" style={{ padding: "4px 0" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(goals) }} />
          ) : (
            <div className="empty">{t("No goals yet. Press Edit.")}</div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="eyebrow">{t("Inbox")}</div>
            <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
              <input
                className="field"
                placeholder={t("Drop an idea or a task, then Enter")}
                aria-label={t("Inbox")}
                value={capture}
                onChange={(e) => setCapture(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && capture.trim()) {
                    await homeApi.inbox(capture, null);
                    setCapture("");
                    load();
                  }
                }}
              />
            </div>
            <div className="md" style={{ padding: 0, fontSize: 13 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(inbox.replace(/^# Inbox\n+.*\n+/m, "")) }} />
          </div>
          <div className="card">
            <div className="eyebrow">{t("Today's log")}</div>
            {log ? (
              <div className="md" style={{ padding: 0, fontSize: 13 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(log.replace(/^# .*\n+/, "")) }} />
            ) : (
              <div className="empty">{t("Nothing yet today.")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
