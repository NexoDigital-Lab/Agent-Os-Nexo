// The notes column: add, filter by project, search, and tick notes to analyze together.
import { Check, Plus } from "lucide-react";
import { ago } from "@os/lib/format";
import { toggled } from "@os/lib/ui";
import type { Note } from "../api";
import { t } from "@os/i18n";

export function NoteList({ notes, current, selected, setSelected, q, setQ, projFilter, setProjFilter, allProjects, repoNames, onPick, onAdd }: {
  notes: Note[]; // already filtered
  current: Note | null;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  q: string;
  setQ: (q: string) => void;
  projFilter: string;
  setProjFilter: (p: string) => void;
  allProjects: string[];
  repoNames: string[];
  onPick: (n: Note) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="n-list">
      <div className="n-list-head">
        <button className="btn primary sm" onClick={onAdd}><Plus size={14} /> {t("Note")}</button>
        <select className="field" aria-label={t("Project")} value={projFilter} onChange={(e) => setProjFilter(e.target.value)}>
          <option value="">{t("All projects")}</option>
          {allProjects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <input className="field n-search" placeholder={t("Search notes…")} aria-label={t("Search notes…")} value={q} onChange={(e) => setQ(e.target.value)} />
      {notes.length === 0 && <div className="empty" style={{ padding: 30 }}>{t("No notes. Press")} <Plus size={13} /> {t("Note")}.</div>}
      {notes.map((n) => (
        <div key={n.id} className={`n-item ${current?.id === n.id ? "on" : ""}`} onClick={() => onPick(n)}>
          <input
            type="checkbox"
            title={t("Include in the analysis")} aria-label={t("Include in the analysis")}
            checked={selected.has(n.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => setSelected(toggled(selected, n.id))}
          />
          <div className="n-item-body">
            <div className="n-title">{n.title || n.body.split("\n")[0] || t("Untitled note")}</div>
            <div className="n-meta">
              <span className={`pill ${repoNames.includes(n.project) ? "" : "info"}`}>{n.project}</span>
              <span>{ago(n.updatedAt)}</span>
              {n.analyzedAt && <span className="ok-txt"><Check size={12} /> {t("analyzed")}</span>}
            </div>
          </div>
        </div>
      ))}
    </aside>
  );
}
