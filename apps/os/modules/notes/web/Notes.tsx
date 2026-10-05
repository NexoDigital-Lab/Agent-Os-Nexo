// Notes: free notes per project (auto-saved) → an AI proposes features → the features board.
import { Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProjects } from "../../projects/web/store";
import { notesApi as api, type Draft, type Note } from "./api";
import { FeatureBoard } from "./parts/FeatureBoard";
import { NoteEditor } from "./parts/NoteEditor";
import { NoteList } from "./parts/NoteList";
import { ProposalPanel } from "./parts/ProposalPanel";
import { t } from "@os/i18n";

export function Notes() {
  const projects = useProjects();
  const [notes, setNotes] = useState<Note[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [current, setCurrent] = useState<Note | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [projFilter, setProjFilter] = useState("");
  const [saved, setSaved] = useState<"" | "saving" | "saved">("");
  const [panel, setPanel] = useState<"propose" | "board">("propose");
  const [error, setError] = useState("");
  const timer = useRef<number>(0);

  const reloadDrafts = () => void api.drafts().then(setDrafts, () => {});
  useEffect(() => {
    void api.notes().then(setNotes, () => {});
    reloadDrafts();
  }, []);

  const repoNames = projects.map((p) => p.id);
  const allProjects = useMemo(() => [...new Set([...repoNames, ...notes.map((n) => n.project), ...drafts.map((d) => d.project)])].sort(), [projects, notes, drafts]);

  /** Edits the open note and saves it 600 ms after the last keystroke. */
  function edit(patch: Partial<Note>) {
    if (!current) return;
    const next = { ...current, ...patch };
    setCurrent(next);
    setNotes((prev) => prev.map((n) => (n.id === next.id ? next : n)));
    setSaved("saving");
    clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const s = await api.saveNote(next);
        setNotes((prev) => prev.map((n) => (n.id === s.id ? s : n)));
        setSaved("saved");
      } catch (e) {
        setError(t((e as Error).message));
      }
    }, 600);
  }

  async function addNote() {
    const n = await api.saveNote({ title: "", project: projFilter || current?.project || repoNames[0] || "general", body: "" });
    setNotes((prev) => [n, ...prev]);
    setCurrent(n);
    setSelected(new Set([n.id]));
    setTimeout(() => document.getElementById("note-body")?.focus(), 50);
  }

  async function removeNote(n: Note) {
    await api.deleteNote(n.id);
    setNotes((prev) => prev.filter((x) => x.id !== n.id));
    if (current?.id === n.id) setCurrent(null);
  }

  const shownNotes = notes.filter((n) => (!projFilter || n.project === projFilter) && (!q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase())));
  const toAnalyze = selected.size ? notes.filter((n) => selected.has(n.id)) : current ? [current] : [];
  const boardProject = projFilter || current?.project || "";
  const openCount =
    projects.filter((p) => !boardProject || p.id === boardProject).reduce((n, p) => n + p.features.filter((f) => f.status !== "done").length, 0) +
    drafts.filter((d) => !boardProject || d.project === boardProject).length;

  return (
    <div className="notes">
      <NoteList
        notes={shownNotes}
        current={current}
        selected={selected}
        setSelected={setSelected}
        q={q}
        setQ={setQ}
        projFilter={projFilter}
        setProjFilter={setProjFilter}
        allProjects={allProjects}
        repoNames={repoNames}
        onPick={setCurrent}
        onAdd={addNote}
      />

      <section className="n-editor">
        {current ? (
          <NoteEditor key={current.id} note={current} saved={saved} allProjects={allProjects} repoNames={repoNames} onEdit={edit} onRemove={() => removeNote(current)} />
        ) : (
          <div className="empty" style={{ marginTop: 100 }}>
            <p>{t("Pick a note or create one.")}</p>
            <button className="btn primary" onClick={addNote}><Plus size={14} /> {t("Note")}</button>
          </div>
        )}
      </section>

      <aside className="n-side">
        <div className="side-tabs">
          <button className={panel === "propose" ? "on" : ""} onClick={() => setPanel("propose")}><Sparkles size={14} /> {t("Propose features")}</button>
          <button className={panel === "board" ? "on" : ""} onClick={() => setPanel("board")}>
            {t("Features")} <span className="pill">{openCount}</span>
          </button>
        </div>
        <div className="n-side-body">
          {panel === "propose" && (
            <ProposalPanel
              toAnalyze={toAnalyze}
              repoNames={repoNames}
              onNotesChanged={() => api.notes().then(setNotes)}
              onCreated={(project) => (setProjFilter(project), setPanel("board"), reloadDrafts())}
              onError={setError}
            />
          )}
          {panel === "board" && (
            <FeatureBoard projects={projects} drafts={drafts} reloadDrafts={reloadDrafts} project={boardProject} setProject={setProjFilter} allProjects={allProjects} />
          )}
          {error && <div className="errline">{error}</div>}
        </div>
      </aside>
    </div>
  );
}
