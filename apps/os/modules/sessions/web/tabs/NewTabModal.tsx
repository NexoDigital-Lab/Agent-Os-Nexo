// "New tab": pick the project (or a worktree) and an optional feature/title.
import { useState } from "react";
import type { Project } from "../../../projects/web/api";
import { t } from "@os/i18n";

type NewTab = { project: string; title: string; worktree?: string };

export function NewTabModal({ initial, projects, onOpen, onClose }: { initial: NewTab; projects: Project[]; onOpen: (t: NewTab) => void; onClose: () => void }) {
  const [newTab, setNewTab] = useState(initial);
  return (
    <div className="modal-bg" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("New tab")}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onOpen(newTab);
        }}
      >
        <h3>{t("New tab")}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("Each tab is its own AI session, like opening another terminal.")}</p>
        <label className="eyebrow" htmlFor="nt-project">{t("Project")}</label>
        <select id="nt-project" className="field" value={newTab.project} onChange={(e) => setNewTab({ ...newTab, project: e.target.value, worktree: undefined })}>
          {projects.filter((p) => p.path).map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
        {newTab.worktree && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t("In the worktree")} <span className="mono">worktrees/{newTab.worktree}</span>
          </p>
        )}
        <label className="eyebrow" htmlFor="nt-title">{t("Feature / title")}</label>
        <input id="nt-title" autoFocus className="field" placeholder={t("e.g. 0007 fix login, or leave it empty")} value={newTab.title} onChange={(e) => setNewTab({ ...newTab, title: e.target.value })} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t("Cancel")}</button>
          <button className="btn primary">{t("Open")}</button>
        </div>
      </form>
    </div>
  );
}
