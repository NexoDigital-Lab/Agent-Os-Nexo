// The Context view of a project tab: AGENTS.md and everything in context/ (features, specs, decisions, proposals, the
// code map) in a tree, an editor with a preview, Ctrl+S to save, and one click to open a file or the folder in VS Code.
import { Eye, FilePlus, FolderOpen, Lock, PenLine, Save, Search, SquareArrowOutUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@os/i18n";
import { renderMarkdown } from "@os/lib/markdown";
import type { TabViewProps } from "../../sessions/web/slots";
import { contextApi as api, type ContextDoc, type ContextFile } from "./api";

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function ContextView({ tab }: TabViewProps) {
  const project = tab.project ?? "";
  const [files, setFiles] = useState<ContextFile[] | null>(null);
  const [doc, setDoc] = useState<ContextDoc | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(true);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.list(project).then(setFiles, (e: Error) => setError(t(e.message))), [project]);
  useEffect(() => void load(), [load]);

  async function open(path: string) {
    setError("");
    try {
      const d = await api.read(project, path);
      setDoc(d);
      setText(d.content);
      setPreview(path.endsWith(".md"));
    } catch (e) {
      setError(t((e as Error).message));
    }
  }
  // AGENTS.md (or the context README) opens first.
  useEffect(() => {
    if (!files || doc) return;
    const first = files.find((f) => f.path === "context/README.md") ?? files.find((f) => f.path === "AGENTS.md");
    if (first) void open(first.path);
  }, [files]); // open() is stable enough: it only reads the project

  const dirty = doc !== null && text !== doc.content;
  const save = useCallback(async () => {
    if (!doc || doc.readOnly || !dirty) return;
    setBusy(true);
    setError("");
    try {
      const d = await api.save(project, doc.path, text, doc.mtime);
      setDoc(d);
      void load();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [doc, dirty, project, text, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  async function create() {
    const name = (creating ?? "").trim().replace(/^\/+/, "");
    if (!name) return;
    const path = name.startsWith("context/") ? name : `context/${name}${/\.[a-z]+$/i.test(name) ? "" : ".md"}`;
    setError("");
    try {
      await api.save(project, path, `# ${nameOf(path).replace(/\.[a-z]+$/i, "")}\n`);
      setCreating(null);
      await load();
      await open(path);
    } catch (e) {
      setError(t((e as Error).message));
    }
  }

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = (files ?? []).filter((f) => !needle || f.path.toLowerCase().includes(needle));
    const map = new Map<string, ContextFile[]>();
    for (const f of shown) map.set(folderOf(f.path), [...(map.get(folderOf(f.path)) ?? []), f]);
    return [...map.entries()];
  }, [files, q]);

  const html = useMemo(() => (doc && preview && doc.path.endsWith(".md") ? renderMarkdown(text) : ""), [doc, preview, text]);

  if (!project) return <div className="empty">{t("This tab has no project.")}</div>;

  return (
    <div className="ctx">
      <aside className="ctx-side">
        <div className="ctx-side-head">
          <span className="eyebrow">{t("Context")}</span>
          <span className="ctx-side-actions">
            <button className="btn sm ghost" title={t("New document")} aria-label={t("New document")} onClick={() => setCreating(creating === null ? "" : null)}><FilePlus size={14} /></button>
            <button className="btn sm ghost" title={t("Open context/ in VS Code")} aria-label={t("Open context/ in VS Code")} onClick={() => void api.open(project).catch((e: Error) => setError(t(e.message)))}><FolderOpen size={14} /></button>
          </span>
        </div>
        {creating !== null && (
          <form className="ctx-new" onSubmit={(e) => (e.preventDefault(), void create())}>
            <input className="field mono" autoFocus value={creating} onChange={(e) => setCreating(e.target.value)} placeholder="specs/login.md" aria-label={t("New document path, inside context/")} />
          </form>
        )}
        <label className="ctx-search">
          <Search size={13} />
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filter")} aria-label={t("Filter documents")} />
        </label>
        <div className="ctx-tree">
          {files === null && <div className="faint ctx-empty">{t("Loading…")}</div>}
          {files?.length === 0 && <div className="faint ctx-empty">{t("No context yet.")}</div>}
          {groups.map(([folder, list]) => (
            <div key={folder} className="ctx-group">
              {folder && <div className="ctx-folder mono">{folder.replace(/^context\/?/, "") || "context"}/</div>}
              {list.map((f) => (
                <button key={f.path} className={`ctx-file${doc?.path === f.path ? " on" : ""}`} onClick={() => void open(f.path)} title={f.path}>
                  <span>{nameOf(f.path)}</span>
                  {f.readOnly && <Lock size={11} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <section className="ctx-main">
        {error && <div className="errline ctx-error" role="alert">{error}</div>}
        {doc ? (
          <>
            <div className="ctx-bar">
              <span className="mono ctx-path">{doc.path}{dirty && <span className="ctx-dirty" title={t("Unsaved changes")}> ●</span>}</span>
              {doc.readOnly && <span className="pill">{t("read-only: edit permissions in Settings")}</span>}
              <span className="ctx-bar-actions">
                {doc.path.endsWith(".md") && (
                  <button className="btn sm ghost" onClick={() => setPreview(!preview)}>
                    {preview ? <><PenLine size={13} /> {t("Edit")}</> : <><Eye size={13} /> {t("Preview")}</>}
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => void api.open(project, doc.path).catch((e: Error) => setError(t(e.message)))}><SquareArrowOutUpRight size={13} /> {t("VS Code")}</button>
                {!doc.readOnly && <button className="btn sm primary" disabled={!dirty || busy} onClick={() => void save()}><Save size={13} /> {busy ? t("Saving…") : t("Save")}</button>}
              </span>
            </div>
            {preview && html ? (
              <div className="md ctx-preview" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <textarea className="ctx-editor mono" value={text} readOnly={doc.readOnly} spellCheck={false} onChange={(e) => setText(e.target.value)} aria-label={doc.path} />
            )}
          </>
        ) : (
          <div className="empty">{t("Pick a document on the left.")}</div>
        )}
      </section>
    </div>
  );
}
