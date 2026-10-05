// The board: every project's features (context/features/*.md) as To do / Doing / Done, plus drafts waiting for
// a project that doesn't exist yet. "Work on it" opens a tab on the project with the feature loaded in the chat.
import { FilePlus2, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { renderMarkdown } from "@os/lib/markdown";
import { notify } from "../../../shell/web/nav";
import { projectsApi, type Feature, type Project } from "../../../projects/web/api";
import { refreshProjects } from "../../../projects/web/store";
import { draftTo, openTab } from "../../../sessions/web/tabs/store";
import { notesApi, type Draft } from "../api";

const TYPE_CLS: Record<Feature["type"], string> = { feature: "accent", bug: "bad", chore: "" };
const STATUSES: { v: Feature["status"]; label: string }[] = [
  { v: "todo", label: "To do" },
  { v: "doing", label: "Doing" },
  { v: "done", label: "Done" },
];
const byPriority = (a: { priority: string }, b: { priority: string }) => a.priority.localeCompare(b.priority);

type Item = { project: string; feature: Feature };

export function FeatureBoard({ projects, drafts, reloadDrafts, project, setProject, allProjects }: {
  projects: Project[];
  drafts: Draft[];
  reloadDrafts: () => void;
  /** "" = every project. */
  project: string;
  setProject: (p: string) => void;
  allProjects: string[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [md, setMd] = useState("");
  const items: Item[] = projects
    .filter((p) => !project || p.id === project)
    .flatMap((p) => p.features.map((feature) => ({ project: p.id, feature })));
  const waiting = drafts.filter((d) => !project || d.project === project);
  const waitingProjects = [...new Set(waiting.map((d) => d.project))];

  useEffect(() => {
    if (!open) return;
    const [p, slug] = open.split("::") as [string, string];
    void projectsApi.feature(p, slug).then((r) => setMd(r.markdown.replace(/^---[\s\S]*?---\s*/, "")), () => setMd(""));
  }, [open]);

  const patch = async (it: Item, change: Partial<Pick<Feature, "status" | "priority">>) => {
    await projectsApi.setFeature(it.project, it.feature.slug, change);
    await refreshProjects();
  };

  async function work(it: Item) {
    const path = `context/features/${it.feature.slug}.md`;
    if (it.feature.status === "todo") await patch(it, { status: "doing" });
    const tabId = await openTab(it.project, it.feature.title.slice(0, 60));
    draftTo(tabId, t("Work on the feature {path} with nexo-dev: read it first, it has the context and the acceptance criteria.", { path }));
  }

  return (
    <>
      <select className="field" aria-label={t("Project")} style={{ marginBottom: 10 }} value={project} onChange={(e) => setProject(e.target.value)}>
        <option value="">{t("All projects")}</option>
        {allProjects.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      {STATUSES.map((st) => {
        const col = items.filter((i) => i.feature.status === st.v).sort((a, b) => byPriority(a.feature, b.feature));
        return (
          <div key={st.v} className="t-col">
            <div className="eyebrow t-col-head">{t(st.label)} · {col.length}</div>
            {col.map((it) => {
              const key = `${it.project}::${it.feature.slug}`;
              const f = it.feature;
              return (
                <div key={key} className={`ticket ${f.status}`}>
                  <button className="ticket-head" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                    <span className={`pill ${TYPE_CLS[f.type]}`}>{t(f.type)}</span>
                    <span className="pill">{f.priority}</span>
                    <span className="pill">{f.size}</span>
                    <span className="ticket-title">{f.title}</span>
                  </button>
                  {!project && <div className="faint mono" style={{ fontSize: 11 }}>{it.project}</div>}
                  {open === key && <div className="ticket-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />}
                  <div className="ticket-actions">
                    <select aria-label={t("Status")} value={f.status} onChange={(e) => void patch(it, { status: e.target.value as Feature["status"] })}>
                      {STATUSES.map((s) => <option key={s.v} value={s.v}>{t(s.label)}</option>)}
                    </select>
                    <select aria-label={t("Priority")} value={f.priority} onChange={(e) => void patch(it, { priority: e.target.value as Feature["priority"] })}>
                      {["P0", "P1", "P2", "P3"].map((x) => <option key={x}>{x}</option>)}
                    </select>
                    <button className="btn sm" title={t("Opens a tab on the project with the feature loaded")} onClick={() => void work(it)}>
                      <Play size={14} /> {t("Work on it")}
                    </button>
                    <button
                      className="btn sm ghost danger"
                      aria-label={t("Delete the feature")}
                      onClick={async () => {
                        if (!confirm(t("Move the feature \"{title}\" to the trash?", { title: f.title }))) return;
                        await projectsApi.removeFeature(it.project, f.slug);
                        await refreshProjects();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {waitingProjects.map((p) => (
        <div key={p} className="t-col">
          <div className="eyebrow t-col-head">{t("Waiting for the project {name} · {n}", { name: p, n: waiting.filter((d) => d.project === p).length })}</div>
          <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>{t("They become features in its context/features/ once the project exists.")}</p>
          {allProjects.includes(p) && projects.some((x) => x.id === p) && (
            <button
              className="btn sm primary"
              style={{ marginBottom: 8 }}
              onClick={async () => {
                const r = await notesApi.promoteDrafts(p);
                notify(t("{n} feature(s) saved in {project}", { n: r.features.length, project: p }));
                reloadDrafts();
                await refreshProjects();
              }}
            >
              <FilePlus2 size={14} /> {t("Save them as features")}
            </button>
          )}
          {waiting.filter((d) => d.project === p).sort(byPriority).map((d) => (
            <div key={d.id} className="ticket todo">
              <div className="ticket-head">
                <span className={`pill ${TYPE_CLS[d.type]}`}>{t(d.type)}</span>
                <span className="pill">{d.priority}</span>
                <span className="pill">{d.size}</span>
                <span className="ticket-title">{d.title}</span>
              </div>
              <div className="ticket-actions">
                <button className="btn sm ghost danger" aria-label={t("Delete the draft")} onClick={async () => (await notesApi.deleteDraft(d.id), reloadDrafts())}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
      {items.length === 0 && waiting.length === 0 && <div className="empty">{t("No features here yet.")}</div>}
    </>
  );
}
