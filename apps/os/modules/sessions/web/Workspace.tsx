// The Tabs view: projects on the left, the open tabs on top, the active tab below.
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { readStr, writeStr } from "@os/lib/storage";
import { notify } from "../../shell/web/nav";
import { onProjectCreated, onProjectDeleted, openDeleteProject, openNewProject } from "../../projects/web/events";
import { useProjects } from "../../projects/web/store";
import { sessionsApi, type HistoryItem, type Skill } from "./api";
import { TabView } from "./TabView";
import { handoffTo } from "./tabs/handoff";
import { NewTabModal } from "./tabs/NewTabModal";
import { ProjectsSidebar } from "./tabs/ProjectsSidebar";
import { closeTab, focusTab, openTab, refreshTabs, setActive, useTabs } from "./tabs/store";
import { TabBar } from "./tabs/TabBar";

/** Resumes a past session in a tab (or jumps to the tab that already has it). */
export async function resumeSession(h: HistoryItem): Promise<void> {
  try {
    const r = await sessionsApi.resume(h.id);
    await refreshTabs();
    focusTab(r.id);
    if (r.forked) notify(t("That session is still live elsewhere: it opened as a copy so the original stays untouched."));
  } catch (e) {
    notify(t((e as Error).message));
  }
}

export function Workspace() {
  const projects = useProjects();
  const { tabs, active } = useTabs();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [newTab, setNewTab] = useState<{ project: string; title: string; worktree?: string } | null>(null);
  const [feature, setFeature] = useState<{ tab: string; slug: string } | null>(null);
  const [startView, setStartView] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(readStr("projCollapsed") === "1");
  useEffect(() => writeStr("projCollapsed", collapsed ? "1" : "0"), [collapsed]);

  useEffect(() => {
    void sessionsApi.skills().then(setSkills, () => {});
    const load = () => void sessionsApi.history(10).then(setHistory, () => {});
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  // A new or cloned project opens in a tab, straight into its setup when asked.
  useEffect(
    () =>
      onProjectCreated(async ({ id, url, setup }) => {
        const tabId = await openTab(id);
        if (setup) {
          handoffTo(tabId, "setup", true);
          setStartView((s) => ({ ...s, [tabId]: "editor" }));
        }
        if (url) notify(t("Project ready: {url}", { url }));
      }),
    [],
  );
  useEffect(() => onProjectDeleted(({ gone }) => void (gone && refreshTabs())), []);

  const tab = tabs.find((x) => x.id === active) ?? tabs[0] ?? null;
  const firstProject = projects.find((p) => p.path)?.id ?? "";
  const openProject = (id: string) => setNewTab({ project: id, title: "" });

  return (
    <div className="ws" style={{ gridTemplateColumns: collapsed ? "28px 1fr" : undefined }}>
      {collapsed ? (
        <button className="proj-expand" title={t("Show projects")} aria-label={t("Show projects")} onClick={() => setCollapsed(false)}>»</button>
      ) : (
        <ProjectsSidebar
          projects={projects}
          tabs={tabs}
          tab={tab}
          history={history}
          onOpenProject={openProject}
          onOpenWorktree={(project, worktree) => setNewTab({ project, title: "", worktree })}
          onFeature={(slug) => tab && setFeature({ tab: tab.id, slug })}
          onResume={(h) => void resumeSession(h)}
          onCreate={openNewProject}
          onDelete={openDeleteProject}
          onCollapse={() => setCollapsed(true)}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <TabBar
          tabs={tabs}
          active={tab?.id ?? null}
          onSelect={setActive}
          onRename={async (x) => {
            const title = window.prompt(t("Tab name"), x.title);
            if (title) await sessionsApi.renameTab(x.id, title).then(refreshTabs);
          }}
          onClose={(id) => void closeTab(id)}
          onNew={() => setNewTab({ project: tab?.project || firstProject, title: "" })}
        />
        {tab ? (
          <TabView key={tab.id} tab={tab} skills={skills} openFeature={feature?.tab === tab.id ? feature.slug : null} initialView={startView[tab.id]} />
        ) : (
          <div className="empty" style={{ marginTop: 80 }}>
            <p>{t("No open tabs.")}</p>
            <button className="btn primary" disabled={!firstProject} onClick={() => setNewTab({ project: firstProject, title: "" })}><Plus size={14} /> {t("New tab")}</button>
            {!firstProject && <p className="faint">{t("Create or clone a project first.")}</p>}
          </div>
        )}
      </div>
      {newTab && (
        <NewTabModal
          initial={newTab}
          projects={projects}
          onOpen={async (x) => {
            setNewTab(null);
            await openTab(x.project, x.title, x.worktree);
          }}
          onClose={() => setNewTab(null)}
        />
      )}
    </div>
  );
}
