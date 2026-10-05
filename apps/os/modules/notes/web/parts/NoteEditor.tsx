// The open note: title, project (existing repo or a new one) and body. Saving is automatic (debounced upstream).
import { Trash2, X } from "lucide-react";
import { useState } from "react";
import type { Note } from "../api";
import { t } from "@os/i18n";
import { ConfirmButton } from "@os/lib/ConfirmButton";

export function NoteEditor({ note, saved, allProjects, repoNames, onEdit, onRemove }: {
  note: Note;
  saved: string;
  allProjects: string[];
  repoNames: string[];
  onEdit: (patch: Partial<Note>) => void;
  onRemove: () => void;
}) {
  const [newProject, setNewProject] = useState<string | null>(null);
  const current = note;
  return (
    <>
      <div className="n-editor-head">
        <input className="n-title-input" placeholder={t("Title (optional)")} aria-label={t("Title (optional)")} value={current.title} onChange={(e) => onEdit({ title: e.target.value })} />
        <span className="faint mono" style={{ fontSize: 11.5 }}>{saved && t(saved)}</span>
        <ConfirmButton className="btn sm ghost danger" title={t("Delete note")} confirmText={t("Delete the note \"{title}\"?", { title: note.title || note.body.slice(0, 40) || t("untitled") })} onConfirm={onRemove}><Trash2 size={14} /></ConfirmButton>
      </div>
      <div className="n-proj">
        <span className="eyebrow">{t("Project")}</span>
        {newProject === null ? (
          <select
            className="field"
            aria-label={t("Project")}
            value={current.project}
            onChange={(e) => (e.target.value === "__new" ? setNewProject("") : onEdit({ project: e.target.value }))}
          >
            {!allProjects.includes(current.project) && <option value={current.project}>{current.project}</option>}
            {allProjects.map((p) => <option key={p} value={p}>{p}{repoNames.includes(p) ? "" : ` ${t("(new)")}`}</option>)}
            <option value="__new">{t("New project…")}</option>
          </select>
        ) : (
          <form
            style={{ display: "flex", gap: 6, flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (newProject.trim()) onEdit({ project: newProject.trim() });
              setNewProject(null);
            }}
          >
            <input autoFocus className="field" placeholder={t("Name of the new project")} aria-label={t("Name of the new project")} value={newProject} onChange={(e) => setNewProject(e.target.value)} />
            <button className="btn sm primary">{t("OK")}</button>
            <button type="button" className="btn sm ghost" aria-label={t("Cancel")} onClick={() => setNewProject(null)}><X size={14} /></button>
          </form>
        )}
        <span className="faint" style={{ fontSize: 12 }}>{repoNames.includes(current.project) ? t("existing project") : t("new project, not created yet")}</span>
      </div>
      <textarea
        id="note-body"
        className="n-body"
        placeholder={t("Write down whatever comes to mind: bugs you saw, ideas, missing things…\nThen an AI analyzes it and turns it into features.")}
        aria-label={t("Note")}
        value={current.body}
        onChange={(e) => onEdit({ body: e.target.value })}
      />
    </>
  );
}
