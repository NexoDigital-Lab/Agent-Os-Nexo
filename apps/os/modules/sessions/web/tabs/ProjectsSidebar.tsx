// The Tabs view's left column: projects (branch, changes, live tabs), their worktrees and features, and the
// recent AI sessions. Collapsible to a thin strip for more editor room.
import { Plus, Trash2 } from "lucide-react";
import { BranchIcon } from "@os/lib/icons";
import type { Project } from "../../../projects/web/api";
import type { HistoryItem, Tab } from "../api";
import { History } from "../History";
import { StatusGlyph } from "./StatusGlyph";
import { t } from "@os/i18n";

const RANK: Record<Tab["status"], number> = { needs_you: 4, error: 3, done: 2, working: 1, idle: 0 };
/** The status that deserves the glyph among a project's tabs: the most urgent one. */
const topStatus = (ts: Tab[]): Tab | undefined => ts.filter((t) => t.status !== "idle").sort((a, b) => RANK[b.status] - RANK[a.status])[0];

export function ProjectsSidebar({ projects, tabs, tab, history, onOpenProject, onOpenWorktree, onFeature, onResume, onCreate, onDelete, onCollapse }: {
  projects: Project[];
  tabs: Tab[];
  tab: Tab | null; // the active tab
  history: HistoryItem[];
  onOpenProject: (id: string) => void;
  onOpenWorktree: (project: string, worktree: string) => void;
  onFeature: (slug: string) => void;
  onResume: (h: HistoryItem) => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
  onCollapse: () => void;
}) {
  return (
    <aside className="projects">
      <div className="eyebrow">
        <button className="add-proj" title={t("Hide projects (more room for the editor)")} aria-label={t("Hide projects (more room for the editor)")} onClick={onCollapse}>«</button>
        <span style={{ flex: 1, marginLeft: 6 }}>{t("Projects · {n}", { n: projects.length })}</span>
        <button className="add-proj" title={t("New project, or clone one of yours from GitHub")} aria-label={t("New project")} onClick={onCreate}><Plus size={14} /></button>
      </div>
      {projects.map((p) => {
        const isOn = tab?.project === p.id;
        const mainOn = isOn && !tab.worktree;
        const own = tabs.filter((x) => x.project === p.id && !x.worktree);
        return (
          <div key={p.id}>
            <div className={`proj ${mainOn ? "on" : ""}${p.path ? "" : " off"}`} onClick={() => p.path && onOpenProject(p.id)} title={p.path ? t("Open a new tab") : t("No code/ yet")}>
              <div className="name">
                <span>{p.workspace && <span className="faint">{p.workspace} / </span>}{p.name}</span>
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {topStatus(own) ? <StatusGlyph tab={topStatus(own)!} /> : own.some((x) => x.running) ? <span className="dot live" /> : p.changed > 0 ? <span className="pill accent">{p.changed}</span> : null}
                  <button className="del-proj" title={t("Delete {name}…", { name: p.id })} aria-label={t("Delete {name}…", { name: p.id })} onClick={(e) => (e.stopPropagation(), onDelete(p.id))}><Trash2 size={14} /></button>
                </span>
              </div>
              <div className="meta">
                <span className="branch"><BranchIcon /> {p.branch}</span>
              </div>
            </div>
            {p.worktrees.map((w) => {
              const wtTabs = tabs.filter((x) => x.project === p.id && x.worktree === w.name);
              return (
                <div
                  key={w.name}
                  className={`proj wt ${isOn && tab.worktree === w.name ? "on" : ""}`}
                  onClick={() => onOpenWorktree(p.id, w.name)}
                  title={t("Worktree of {project} in worktrees/{name}: open a tab there", { project: p.id, name: w.name })}
                >
                  <div className="name">
                    <span className="branch">↳ <BranchIcon /> {w.branch}</span>
                    {topStatus(wtTabs) ? <StatusGlyph tab={topStatus(wtTabs)!} /> : wtTabs.some((x) => x.running) ? <span className="dot live" /> : w.changed > 0 ? <span className="pill accent">{w.changed}</span> : null}
                  </div>
                  <div className="meta faint">worktree · {w.name}</div>
                </div>
              );
            })}
            {isOn && p.features.length > 0 && (
              <div className="feats">
                {p.features.slice(0, 12).map((f) => (
                  <div key={f.slug} className={`feat ${f.status}`} title={`${f.title} · ${t(f.status)}`} onClick={() => onFeature(f.slug)}>
                    {f.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="eyebrow" style={{ marginTop: 18 }}>
        <span>{t("Recent")}</span>
        <span>{t("{n} live", { n: history.filter((h) => h.active).length })}</span>
      </div>
      <History items={history} onResume={onResume} compact tabs={tabs} />
    </aside>
  );
}
