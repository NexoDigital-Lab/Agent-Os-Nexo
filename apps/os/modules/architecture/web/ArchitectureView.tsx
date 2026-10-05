// "Architecture" tab view: the project's proposed folder tree + per-folder rules + the global architecture.md.
// It is a plan stored in the project's context/architecture/ — it never touches the repository.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderPlus, Sparkles } from "lucide-react";
import { archApi as api, type ArchNode } from "./api";
import type { TabViewProps } from "../../sessions/web/slots";
import { refreshTabs } from "../../sessions/web/tabs/store";
import { ArchTree } from "./ArchTree";
import { md, nameError, pathOf, subtreeIds } from "./util";
import { t } from "@os/i18n";

type Save = "idle" | "pending" | "saving" | "saved" | "failed";

/**
 * Debounced autosave. PUTs are serialized (one in flight per kind) and always send the latest state, so a slow
 * response can never overwrite a newer one. A failed save stays "failed" + dirty until a retry succeeds.
 * `flush` saves now and resolves when nothing is left to send (also on unmount, best effort).
 */
function useAutosave(run: () => Promise<unknown>, onState: (s: Save) => void, onError: (m: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const runRef = useRef(run);
  runRef.current = run;
  const stateRef = useRef(onState);
  stateRef.current = onState;
  const errRef = useRef(onError);
  errRef.current = onError;

  const flush = useCallback((): Promise<void> => {
    if (timer.current) (clearTimeout(timer.current), (timer.current = null));
    chain.current = chain.current.then(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      stateRef.current("saving");
      try {
        await runRef.current();
        errRef.current("");
        stateRef.current(dirty.current ? "pending" : "saved");
      } catch (e) {
        dirty.current = true;
        errRef.current(String((e as Error).message ?? e));
        stateRef.current("failed");
      }
    });
    return chain.current;
  }, []);
  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    stateRef.current("pending");
    timer.current = setTimeout(() => void flush(), 800);
  }, [flush]);
  const failed = useCallback(() => dirty.current, []);
  useEffect(() => () => void flush(), [flush]);
  return { schedule, flush, failed };
}

function MdEditor({ value, onChange, label, placeholder, rows }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; rows?: number }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="arch-md">
      <div className="seg arch-seg" role="group" aria-label={t("{label} mode", { label })}>
        <button className={!preview ? "on" : ""} aria-pressed={!preview} onClick={() => setPreview(false)}>{t("Edit")}</button>
        <button className={preview ? "on" : ""} aria-pressed={preview} onClick={() => setPreview(true)}>{t("Preview")}</button>
      </div>
      {preview ? (
        value.trim() ? <div className="md arch-preview" dangerouslySetInnerHTML={{ __html: md(value) }} /> : <p className="faint arch-preview">{t("Nothing written yet.")}</p>
      ) : (
        <textarea className="field mono arch-ta" rows={rows ?? 12} value={value} aria-label={label} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function ArchitectureView({ tab }: TabViewProps) {
  const project = tab.project;
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [started, setStarted] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [nodes, setNodes] = useState<ArchNode[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [docState, setDocState] = useState<Save>("idle");
  const [treeState, setTreeState] = useState<Save>("idle");
  const [error, setError] = useState(""); // save / load-adjacent errors
  const [treeErr, setTreeErr] = useState(""); // validation errors of tree actions
  const [importing, setImporting] = useState(false);
  const [addReq, setAddReq] = useState<{ parentId: string | null; nonce: number } | null>(null);
  const [follow, setFollow] = useState(() => !tab.meta?.archOff);
  const [followErr, setFollowErr] = useState("");

  const mdRef = useRef(markdown);
  mdRef.current = markdown;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const docSave = useAutosave(() => api.saveDoc(project, mdRef.current), setDocState, setError);
  const treeSave = useAutosave(() => api.saveTree(project, { nodes: nodesRef.current }), setTreeState, setError);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    api.get(project).then(
      (d) => {
        if (!live) return;
        setMarkdown(d.markdown);
        setNodes(d.tree.nodes);
        setStarted(d.exists);
        setLoaded(true);
      },
      (e) => live && (setLoadErr(String(e.message ?? e)), setLoaded(true)),
    );
    return () => void (live = false);
  }, [project]);

  const sel = selected ? nodes.find((n) => n.id === selected) ?? null : null;
  useEffect(() => {
    if (selected && !sel) setSelected(null);
  }, [selected, sel]);

  const editDoc = (v: string) => (setMarkdown(v), setStarted(true), docSave.schedule());
  const editNodes = (next: ArchNode[]) => (setNodes(next), nodesRef.current = next, setStarted(true), treeSave.schedule());

  async function doImport() {
    setImporting(true);
    setError("");
    try {
      await treeSave.flush(); // never drop local edits: they must be on the server before the import replaces them
      if (treeSave.failed()) throw new Error(t("Your tree changes could not be saved; retry saving before importing."));
      const tree = await api.importTree(project);
      setNodes(tree.nodes);
      nodesRef.current = tree.nodes;
      setStarted(true);
      setTreeState("saved");
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setImporting(false);
    }
  }

  // top level, or inside the selected folder; the tree puts the new one in inline rename
  const newFolder = () => setAddReq((r) => ({ parentId: selected, nonce: (r?.nonce ?? 0) + 1 }));

  async function toggleFollow() {
    const on = !follow;
    setFollow(on);
    setFollowErr("");
    try {
      await api.setTabArch(tab.id, on);
      void refreshTabs();
    } catch (e) {
      setFollow(!on);
      setFollowErr(String((e as Error).message ?? e));
    }
  }

  const moveTargets = useMemo(() => {
    if (!sel) return [];
    const bad = subtreeIds(nodes, sel.id);
    return nodes.filter((n) => !bad.has(n.id)).map((n) => ({ id: n.id, path: pathOf(nodes, n.id) })).sort((a, b) => a.path.localeCompare(b.path));
  }, [nodes, sel]);

  function moveSel(parentId: string | null) {
    if (!sel) return;
    const err = nameError(nodes, sel.id, parentId, sel.name);
    if (err) return setTreeErr(t("Cannot move: {error}", { error: err }));
    setTreeErr("");
    editNodes(nodes.map((n) => (n.id === sel.id ? { ...n, parentId } : n)));
  }

  const status = (s: Save) => (s === "saving" ? t("Saving…") : s === "pending" ? t("Unsaved changes…") : s === "saved" ? t("Saved") : "");
  const anyFailed = docState === "failed" || treeState === "failed";
  const overall: Save = anyFailed ? "failed" : docState === "saving" || treeState === "saving" ? "saving" : docState === "pending" || treeState === "pending" ? "pending" : docState === "saved" || treeState === "saved" ? "saved" : "idle";
  const retry = () => {
    if (docState === "failed") void docSave.flush();
    if (treeState === "failed") void treeSave.flush();
  };

  if (!loaded) return <div className="page"><p className="faint"><span className="spin" /> {t("Loading the architecture…")}</p></div>;
  if (loadErr) return <div className="page"><p className="dk-warn" role="alert">{t("Could not load the architecture: {error}", { error: loadErr })}</p></div>;

  return (
    <div className="page arch-page">
      <div className="arch-head">
        <div>
          <h1>{t("Architecture")}</h1>
          <p className="sub">{t("A plan for how to organize")} <span className="mono">{project}</span>. {t("It doesn't touch the repository; the agent gets it as context.")}</p>
        </div>
        <div className="arch-head-r">
          <span className="faint arch-state" role="status" aria-live="polite">
            {anyFailed ? (
              <>
                <span className="dk-warn">{t("Unsaved changes")}</span> · <button className="btn sm arch-retry" onClick={retry}>{t("Retry")}</button>
              </>
            ) : (
              status(overall)
            )}
          </span>
          <button role="switch" aria-checked={follow} className={`ssh-share arch-follow${follow ? " on" : ""}`} onClick={toggleFollow}>
            <span className="ssh-track"><span className="ssh-knob" /></span>
            <span className="ssh-share-label">{t("The agent follows it in this tab")}</span>
          </button>
        </div>
      </div>
      {followErr && <p className="dk-warn" role="alert">{followErr}</p>}
      {error && <p className="errline" role="alert">{error}</p>}

      {!started ? (
        <div className="card arch-empty">
          <h3>{t("You haven't defined an architecture yet")}</h3>
          <p className="faint">
            {t("Here you lay out the folder structure you want, the rules of each folder and a general document (layers, rules, conventions).")}{" "}
            {t("Then the Architect tells you where to start and what is missing, and the agent follows it in every session.")}
          </p>
          <div className="arch-empty-btns">
            <button className="btn primary" onClick={doImport} disabled={importing}>{importing ? <span className="spin" /> : <Download size={14} />} {t("Import current structure")}</button>
            <button className="btn" onClick={() => (setStarted(true), docSave.schedule())}><Sparkles size={14} /> {t("Start from the template")}</button>
          </div>
        </div>
      ) : (
        <div className="arch-cols">
          <section className="card arch-left" aria-label={t("Proposed folders")} aria-busy={importing}>
            <fieldset className="arch-fs" disabled={importing}>
            <div className="arch-toolbar">
              <button className="btn sm primary" onClick={newFolder}><FolderPlus size={14} /> {t("New folder")}</button>
              <button className="btn sm" onClick={doImport} disabled={importing}>{importing ? <span className="spin" /> : <Download size={14} />} {t("Import current structure")}</button>
              <span className="faint arch-count">{nodes.length === 1 ? t("1 folder") : t("{n} folders", { n: nodes.length })}</span>
            </div>
            <p className="faint arch-hint">{t("Drag a folder onto another to put it inside, or onto “/(repo)” to take it out. Double-click to rename.")}</p>
            <ArchTree nodes={nodes} selected={selected} onSelect={(id) => (setSelected(id), setTreeErr(""))} onChange={editNodes} onError={setTreeErr} addRequest={addReq} />
            {treeErr && <p className="dk-warn" role="alert">{treeErr}</p>}

            <div className="arch-rules">
              {sel ? (
                <>
                  <h3 className="mono arch-rules-title">{pathOf(nodes, sel.id)}</h3>
                  <label className="arch-move">
                    <span className="faint">{t("Move to…")}</span>
                    <select className="field" value={sel.parentId ?? ""} onChange={(e) => moveSel(e.target.value || null)} aria-label={t("Move {name} to another folder", { name: sel.name })}>
                      <option value="">/(repo)</option>
                      {moveTargets.map((m) => <option key={m.id} value={m.id}>{m.path}</option>)}
                    </select>
                  </label>
                  <MdEditor
                    label={t("Rules of {path}", { path: pathOf(nodes, sel.id) })}
                    value={sel.rules}
                    placeholder={t("What goes in this folder, what does NOT, and how it is named.\n- Domain logic only\n- Does not import from infrastructure")}
                    onChange={(v) => editNodes(nodes.map((n) => (n.id === sel.id ? { ...n, rules: v } : n)))}
                  />
                </>
              ) : (
                <p className="faint">{t("Pick a folder to write its rules. Root:")} <span className="mono">/(repo)</span>.</p>
              )}
            </div>
            </fieldset>
          </section>

          <section className="card arch-right" aria-label={t("Architecture document")}>
            <h3 className="arch-doc-title">architecture.md</h3>
            <MdEditor label={t("Architecture document")} value={markdown} rows={24} onChange={editDoc} />
          </section>
        </div>
      )}
    </div>
  );
}
