// The editors open in a workspace: open / close / save (gofmt for Go), follow moves and deletes, autosave,
// and survive a reload (per tab, this browser). Monaco models are keyed by file:///<repo-relative path>.
import { useEffect, useRef, useState } from "react";
import { monaco, languageOf, modelOf } from "./monaco";
import { editorApi as api, type Tab } from "./api";
import { readLS, writeLS } from "@os/lib/storage";
import { isUnder, remapPath } from "./fileTree";
import type { OpenFile } from "./EditorArea";
import type { LspClient } from "../submodules/lsp/web/lsp";
import { t } from "@os/i18n";



export function useOpenFiles({ tab, editorRef, lspClient, autosave, onSaved, onDropped, onError }: {
  tab: Tab;
  editorRef: { current: monaco.editor.IStandaloneCodeEditor | null };
  lspClient: (lang: string) => LspClient | undefined;
  autosave: boolean;
  onSaved: () => void; // files changed on disk
  onDropped: (path: string) => void; // an editor closed (its model is gone)
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activeFile = open.find((o) => o.path === active) ?? null;
  const dirty = open.filter((o) => o.content !== o.saved);

  async function openFile(path: string, isNew = false): Promise<OpenFile> {
    const have = open.find((o) => o.path === path);
    if (have) {
      setActive(path);
      return have;
    }
    const r = await api.readFile(tab.id, path);
    const f: OpenFile = { path, content: r.content, saved: r.exists ? r.content : "\u0000", isNew: !r.exists || isNew };
    setOpen((prev) => (prev.some((o) => o.path === path) ? prev : [...prev, f]));
    setActive(path);
    return f;
  }

  /** Closes every editor whose path matches (no prompts) and disposes their models. */
  function drop(match: (p: string) => boolean) {
    const rest = open.filter((o) => !match(o.path));
    for (const o of open) if (match(o.path)) (modelOf(o.path)?.dispose(), onDropped(o.path));
    setOpen(rest);
    if (active && match(active)) setActive(rest[rest.length - 1]?.path ?? null);
  }

  function close(path: string) {
    const f = open.find((o) => o.path === path);
    if (f && f.content !== f.saved && !confirm(t("{file} has unsaved changes. Close it anyway?", { file: path }))) return;
    drop((p) => p === path);
  }

  /** After a move/rename: editors under `from` follow to `to` (unsaved edits travel along). */
  function repoint(from: string, to: string) {
    for (const o of open) if (isUnder(o.path, from)) modelOf(o.path)?.dispose();
    setOpen((prev) => prev.map((o) => ({ ...o, path: remapPath(o.path, from, to) })));
    setActive((a) => (a ? remapPath(a, from, to) : a));
  }

  const edit = (path: string, content: string) => setOpen((prev) => prev.map((o) => (o.path === path ? { ...o, content } : o)));
  const unsavedUnder = (dir: string) => open.filter((o) => isUnder(o.path, dir) && o.content !== o.saved).length;

  async function save(paths?: string[]) {
    const targets = open.filter((o) => (paths ? paths.includes(o.path) : o.path === active) && o.content !== o.saved);
    if (!targets.length) return;
    setSaving(true);
    try {
      for (const f of targets) {
        let content = f.content;
        const lang = languageOf(f.path);
        const client = lspClient(lang);
        const ed = editorRef.current;
        // Go: gofmt on save (gopls formatting), like VS Code with the Go extension.
        if (lang === "go" && client?.canFormat && f.path === active && ed?.getModel()) {
          await ed.getAction("editor.action.formatDocument")?.run();
          content = ed.getModel()!.getValue();
        }
        await api.writeFile(tab.id, f.path, content);
        const model = modelOf(f.path);
        if (model) client?.saved(model);
        setOpen((prev) => prev.map((o) => (o.path === f.path ? { ...o, content, saved: content, isNew: false } : o)));
      }
      onSaved();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  /** Files rewritten on disk (search & replace): reload the open ones, asking if they had unsaved edits. */
  async function reloadFromDisk(paths: string[]) {
    for (const p of paths) {
      const o = open.find((x) => x.path === p);
      if (!o || (o.content !== o.saved && !confirm(t("{file} had unsaved changes; the replacement is already on disk. Reload it from disk?", { file: p })))) continue;
      const r = await api.readFile(tab.id, p);
      modelOf(p)?.setValue(r.content);
      setOpen((prev) => prev.map((x) => (x.path === p ? { ...x, content: r.content, saved: r.content } : x)));
    }
    onSaved();
  }

  // Restore the editors of the last visit, then keep the list saved.
  const restored = useRef(false);
  useEffect(() => {
    const saved = readLS<{ paths: string[]; active: string | null }>(`openFiles:${tab.id}`, { paths: [], active: null });
    (async () => {
      for (const p of saved.paths) await openFile(p).catch(() => null);
      if (saved.active && saved.paths.includes(saved.active)) setActive(saved.active);
      restored.current = true;
    })();
  }, [tab.id]);
  useEffect(() => {
    if (restored.current) writeLS(`openFiles:${tab.id}`, { paths: open.map((o) => o.path), active });
  }, [open.length, active]);

  // Leaving the editor: drop the models so coming back reloads from disk instead of stale buffers.
  const paths = useRef<string[]>([]);
  paths.current = open.map((o) => o.path);
  useEffect(() => () => paths.current.forEach((p) => modelOf(p)?.dispose()), []);

  // Autosave: a second after you stop typing.
  useEffect(() => {
    if (!autosave || !dirty.length || saving) return;
    const t = setTimeout(() => save(dirty.map((d) => d.path)), 1000);
    return () => clearTimeout(t);
  }, [open, autosave]);

  return { open, active, setActive, activeFile, dirty, saving, openFile, close, drop, repoint, edit, unsavedUnder, save, reloadFromDisk };
}
