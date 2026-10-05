// The editor view of a tab: explorer / changes / search on the left, Monaco in the middle, the panel
// (terminals, problems, environment) below, and Practice on the right. This file only lays out the pieces and
// connects them; state lives in hooks (useOpenFiles, usePractice, useLsp). Terminal, LSP, git, practice and setup
// are submodules: when one is off, its part simply isn't there.
import { Folder, GitBranch, GitCompare, Image, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import { monaco, languageOf, modelOf } from "./monaco";
import { isActive } from "@os/registry";
import { call } from "@os/lib/http";
import type { TabViewProps } from "../../sessions/web/slots";
import { editorApi as api, type EditorPlugin, type FileEntry } from "./api";
import { onOpenFile, setPanelHeight, type OpenFileRequest } from "./bus";
import { readLS, readStr, writeLS, writeStr } from "@os/lib/storage";
import { applyPlugins } from "./editorPlugins";
import { FileExplorer, type ExplorerApi } from "./FileExplorer";
import { isUnder } from "./fileTree";
import { EditorArea, type DiffView } from "./EditorArea";
import { EditorToolbar } from "./EditorToolbar";
import { CoachPanel, PlanSteps } from "../submodules/practice/web/CoachPanel";
import { useOpenFiles } from "./useOpenFiles";
import { useNoPractice, usePractice } from "../submodules/practice/web/usePractice";
import { useLsp, useNoLsp } from "../submodules/lsp/web/useLsp";
import { monacoOptions, SettingsBox, useEditorSettings } from "./settings";
import { bindToMonaco, useShortcuts, type Shortcut } from "./useShortcuts";
import { buildCommands } from "./commands";
import { Panel, type ContainerInfo, type PanelApi, type PanelView } from "./Panel";
import { SourceControl } from "../submodules/scm/web/SourceControl";
import { Search } from "./Search";
import { Palette } from "./Palette";
import { SetupWizard } from "../submodules/setup/web/SetupWizard";
import type { Problem } from "./problems";
import { IMAGE_RE } from "../shared/fileKinds.ts";
import { t } from "@os/i18n";



export function EditorWorkspace({ tab, draft, handoff }: TabViewProps) {
  const has = { terminal: isActive("editor/terminal"), lsp: isActive("editor/lsp"), scm: isActive("editor/scm"), practice: isActive("editor/practice"), setup: isActive("editor/setup") };
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [diff, setDiff] = useState<DiffView | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [split, setSplit] = useState<string | null>(null);
  const [mdPreview, setMdPreview] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [side, setSide] = useState<"files" | "scm" | "search">("files");
  const [container, setContainer] = useState<ContainerInfo | null>(null);
  const [coach, setCoach] = useState(() => readLS("coachOpen", false));
  const [term, setTerm] = useState(false);
  const [termH, setTermH] = useState(() => Number(readStr("termH")) || 300);
  const [panelView, setPanelView] = useState<PanelView>("terms");
  const [palette, setPalette] = useState<null | "files" | "commands">(null);
  const [showSettings, setShowSettings] = useState(false);
  const [setup, setSetup] = useState(false);
  const [searchFocus, setSearchFocus] = useState(0);
  const [scmCount, setScmCount] = useState(0);
  const [scmTick, setScmTick] = useState(0); // bump → Cambios re-reads git
  const [problems, setProblems] = useState<Record<string, Problem[]>>({}); // per terminal
  const [plugins, setPlugins] = useState<EditorPlugin[] | null>(null); // Extensiones: general + this project
  const [error, setError] = useState("");
  const [edMounts, setEdMounts] = useState(0); // bumps on each Monaco mount so per-editor things re-apply
  const [settings, setSettings] = useEditorSettings();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const explorer = useRef<ExplorerApi | null>(null);
  const panelApi = useRef<PanelApi | null>(null);

  const loadFiles = () => api.files(tab.id).then(setFiles).catch(() => {});
  const diskChanged = () => (loadFiles(), setScmTick((n) => n + 1));

  // useOpenFiles needs the language server (gofmt on save) and useLsp needs the active file: a ref breaks the loop.
  const lspRef = useRef<ReturnType<typeof useLsp> | null>(null);
  const files$ = useOpenFiles({
    tab,
    editorRef,
    lspClient: (lang) => lspRef.current?.client(lang),
    autosave: settings.autosave,
    onSaved: diskChanged,
    onDropped: (p) => (practice.zones.forgetFile(p), setSplit((s) => (s === p ? null : s))),
    onError: setError,
  });
  const { open, active, activeFile, dirty } = files$;
  const activeLang = active ? languageOf(active) : null;
  const lsp = (has.lsp ? useLsp : useNoLsp)(tab, activeLang);
  lspRef.current = lsp;

  const practice = (has.practice ? usePractice : useNoPractice)({
    tab,
    editorRef,
    active,
    openFile: (p, isNew) => showFile(() => files$.openFile(p, isNew)),
    saveDirty: () => files$.save(dirty.map((d) => d.path)),
    dirtyCount: dirty.length,
    onPlanned: () => {},
    onError: setError,
  });

  const loadPlugins = () => api.projectPlugins(tab.project).then((p) => setPlugins(p.editor as EditorPlugin[]), () => setPlugins([]));
  useEffect(() => {
    loadFiles();
    void loadPlugins();
    // The docker module answers when the project has a dev container; without it the panel just has host terminals.
    void call<ContainerInfo>("GET", `/api/tabs/${tab.id}/devenv`).then(setContainer, () => setContainer(null));
  }, [tab.id]);
  // Work handed over by other views of this tab: a practice task, the setup assistant, a file to open.
  useEffect(() => {
    const task = handoff.take<string>("practice-task");
    if (task && has.practice) void practice.makePlan(task);
    if (handoff.take<boolean>("setup") && has.setup) setSetup(true);
    const file = handoff.take<OpenFileRequest>("open-file");
    if (file) void openAnyRef.current(file.path, file.line);
    return onOpenFile(tab.id, (req) => {
      handoff.take("open-file");
      void openAnyRef.current(req.path, req.line);
    });
  }, [tab.id]);
  useEffect(() => {
    setPanelHeight(tab.id, term ? termH + 12 : 0);
    return () => setPanelHeight(tab.id, 0);
  }, [term, termH]);
  useEffect(() => {
    if (editorRef.current && plugins) return applyPlugins(plugins, editorRef.current, setError);
  }, [plugins, edMounts]);
  useEffect(() => {
    writeLS("coachOpen", coach);
  }, [coach]);
  useEffect(() => {
    if (practice.plan) setCoach(true);
  }, [!!practice.plan]);

  // Build problems also show in the editor (Error Lens paints them).
  useEffect(() => {
    const all = Object.values(problems).flat();
    for (const o of open) {
      const model = modelOf(o.path);
      if (!model) continue;
      const markers = all
        .filter((p) => p.file === o.path)
        .map((p) => {
          const ln = Math.min(Math.max(1, p.line), model.getLineCount());
          const severity = p.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning;
          return { severity, message: `${p.message} (${p.source})`, startLineNumber: ln, endLineNumber: ln, startColumn: Math.max(1, p.col), endColumn: model.getLineMaxColumn(ln) };
        });
      monaco.editor.setModelMarkers(model, "build", markers);
    }
  }, [problems, open, active, edMounts]);

  // "Go to definition" into another file opens it here.
  const openAnyRef = useRef(openAny);
  openAnyRef.current = openAny;
  useEffect(() => {
    const d = monaco.editor.registerEditorOpener({
      openCodeEditor: (_src, resource, sel) => {
        const line = sel ? ("startLineNumber" in sel ? sel.startLineNumber : sel.lineNumber) : undefined;
        const col = sel ? ("startColumn" in sel ? sel.startColumn : sel.column) : 1;
        openAnyRef.current(resource.path.slice(1), line, col);
        return true;
      },
    });
    return () => d.dispose();
  }, []);

  /** Shows the editor (not a diff or an image) for whatever `open` opens. */
  function showFile<T>(open: () => Promise<T>) {
    setDiff(null);
    setImage(null);
    return open();
  }

  /** Images get a preview; everything else opens in the editor, optionally at a line. */
  async function openAny(path: string, line?: number, col = 1) {
    if (IMAGE_RE.test(path)) return (setDiff(null), setImage(path));
    try {
      await showFile(() => files$.openFile(path));
    } catch (e) {
      return setError(`${path}: ${t((e as Error).message)}`);
    }
    if (line) setTimeout(() => revealAt(line, col), 120);
  }

  function revealAt(line: number, col = 1) {
    const ed = editorRef.current;
    if (!ed) return;
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: col });
    ed.focus();
  }

  async function openDiff(path: string, staged: boolean) {
    try {
      setImage(null);
      setDiff({ path, staged, ...(await api.scmDiff(tab.id, path, staged)) });
    } catch (e) {
      setError(t((e as Error).message));
    }
  }

  async function runCmd(cmd: string) {
    if (!has.terminal) return setError(t("The terminal submodule is off: turn it on in Settings → Modules."));
    if (term && panelApi.current) return panelApi.current.run(cmd);
    try {
      await api.newTerm(tab.id, { run: cmd });
      showPanel("terms");
    } catch (e) {
      setError(t((e as Error).message));
    }
  }

  const showPanel = (v: PanelView) => (setPanelView(v), setTerm(true));
  const showSide = (s: typeof side) => (setSidebar(true), setSide(s));
  const openSearch = () => (showSide("search"), setSearchFocus((n) => n + 1));
  const toggleSplit = () => setSplit((sp) => (sp ? null : active));
  const format = () => editorRef.current?.getAction("editor.action.formatDocument")?.run();

  /** Drag the bar above the panel to resize it; the height sticks (this browser). */
  function dragTerm(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = termH;
    let h = startH;
    const move = (ev: MouseEvent) => setTermH((h = Math.min(Math.max(120, startH + startY - ev.clientY), window.innerHeight - 160)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      writeStr("termH", String(h));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const shortcuts: Shortcut[] = [
    { key: "KeyS", ctrl: true, run: () => files$.save() },
    { key: "KeyP", ctrl: true, run: () => setPalette("files") },
    { key: "KeyP", ctrl: true, shift: true, run: () => setPalette("commands") },
    { key: "KeyF", ctrl: true, shift: true, run: openSearch },
    { key: "KeyF", shift: true, alt: true, run: format },
    { key: "KeyB", ctrl: true, run: () => setSidebar((v) => !v) },
    { key: "Backquote", ctrl: true, run: () => setTerm((v) => !v) },
    { key: "Backslash", ctrl: true, run: toggleSplit },
  ];
  const shortcutRef = useShortcuts(shortcuts);

  const onMount: OnMount = (ed) => {
    editorRef.current = ed;
    setEdMounts((n) => n + 1);
    bindToMonaco(ed, shortcutRef);
    ed.onDidChangeModel(() => setTimeout(practice.zones.tryPending, 0));
    practice.zones.tryPending();
    practice.zones.paint();
  };

  const errorCount = Object.values(problems).flat().filter((p) => p.severity === "error").length;

  return (
    <div className={`practice ${plugins && !plugins.includes("icons") ? "no-icons" : ""}`} style={{ gridTemplateColumns: `${sidebar ? "260px " : ""}minmax(0, 1fr)${coach ? " 330px" : ""}` }}>
      {sidebar && (
        <aside className="p-side">
          <div className="side-tabs">
            <button className={side === "files" ? "on" : ""} onClick={() => setSide("files")}><Folder size={14} /> {t("Files")}</button>
            {has.scm && (
              <button className={side === "scm" ? "on" : ""} onClick={() => setSide("scm")}>
                <GitBranch size={14} /> {t("Changes")} {scmCount > 0 && <span className="pill accent">{scmCount}</span>}
              </button>
            )}
            <button className={side === "search" ? "on" : ""} title={t("Search the project (Ctrl+Shift+F)")} aria-label={t("Search the project (Ctrl+Shift+F)")} onClick={openSearch}><SearchIcon size={14} /></button>
          </div>
          {side === "search" && <Search tab={tab} focusKey={searchFocus} onOpen={openAny} onReplaced={files$.reloadFromDisk} />}
          {side === "scm" && has.scm && <SourceControl tab={tab} onOpenDiff={openDiff} onOpenFile={(p) => openAny(p)} onCount={setScmCount} refreshKey={scmTick} />}
          {side === "files" && (
            <>
              {practice.plan && <PlanSteps plan={practice.plan} review={practice.review} stepId={practice.stepId} onStep={(s) => practice.goToStep(s)} onTerminal={() => showPanel("terms")} />}
              <FileExplorer
                tab={tab}
                files={files}
                active={active}
                onOpen={(p) => openAny(p)}
                onChanged={loadFiles}
                onMoved={files$.repoint}
                onDeleted={(p) => files$.drop((x) => isUnder(x, p))}
                unsavedUnder={files$.unsavedUnder}
                onError={setError}
                apiRef={explorer}
              />
            </>
          )}
        </aside>
      )}

      <section className="p-main">
        <EditorToolbar
          tab={tab}
          open={open}
          active={active}
          highlight={!diff && !image}
          onSelect={(p) => showFile(() => files$.openFile(p))}
          onClose={files$.close}
          lang={activeLang}
          lsp={lsp.status}
          onLspMissing={() => showPanel("env")}
          plugins={plugins}
          canSave={!!activeFile && activeFile.content !== activeFile.saved}
          saving={files$.saving}
          autosave={settings.autosave}
          onSave={() => files$.save()}
          mdPreview={active?.endsWith(".md") ? { on: mdPreview, set: setMdPreview } : null}
          split={{ on: !!split, set: toggleSplit, disabled: !active && !split }}
          onRun={runCmd}
          onSetup={has.setup ? () => setSetup(true) : undefined}
          coach={has.practice ? { on: coach, set: setCoach } : undefined}
          onPalette={() => setPalette("commands")}
          onSettings={() => setShowSettings((v) => !v)}
          sidebar={{ on: sidebar, set: setSidebar }}
          panel={{ on: term, set: setTerm, errors: errorCount }}
        />
        {showSettings && <SettingsBox settings={settings} set={setSettings} onClose={() => setShowSettings(false)} />}
        {diff ? (
          <div className="diff-bar">
            <span><GitCompare size={14} /> <b>{diff.path}</b> <span className="faint">{diff.staged ? t("last commit ↔ staged") : t("staged/commit ↔ your copy")}</span></span>
            <button className="btn sm ghost" onClick={() => openAny(diff.path)}>{t("Open the file")}</button>
            <button className="btn sm ghost" aria-label={t("Close the diff")} onClick={() => setDiff(null)}><X size={14} /></button>
          </div>
        ) : image ? (
          <div className="diff-bar"><span><Image size={14} /> <b>{image}</b></span><button className="btn sm ghost" aria-label={t("Close the image")} onClick={() => setImage(null)}><X size={14} /></button></div>
        ) : active ? (
          <div className="crumbs mono">
            {active.split("/").map((seg, i, all) => <span key={i}>{seg}{i < all.length - 1 && <span className="faint"> › </span>}</span>)}
            {activeFile && activeFile.content !== activeFile.saved && <span className="faint"> · {t("unsaved")}</span>}
          </div>
        ) : null}
        <div className="p-editor">
          <EditorArea
            tab={tab}
            activeFile={activeFile}
            open={open}
            diff={diff}
            image={image}
            split={split}
            setSplit={setSplit}
            mdPreview={mdPreview}
            options={monacoOptions(settings)}
            onMount={onMount}
            onChange={files$.edit}
            emptyText={practice.plan ? t("Pick a step on the left and I take you to the file.") : has.setup ? t("Open a file (Ctrl+P), or set up the project with the assistant.") : t("Open a file (Ctrl+P).")}
          />
        </div>
        {term && (
          <>
            <div className="p-term-split" title={t("Drag to change the height")} onMouseDown={dragTerm} />
            <Panel tab={tab} view={panelView} setView={setPanelView} height={termH} onClose={() => setTerm(false)} problems={problems} setProblems={setProblems} onOpenProblem={(p) => openAny(p.file, p.line, p.col)} apiRef={panelApi} devenv={container} terminals={has.terminal} />
          </>
        )}
      </section>

      {palette && (
        <Palette
          mode={palette}
          files={files.filter((f) => !f.dir).map((f) => f.path)}
          commands={buildCommands({
            setup: has.setup ? () => setSetup(true) : undefined,
            save: () => files$.save(),
            saveAll: () => files$.save(dirty.map((d) => d.path)),
            format,
            newEntry: (kind) => (showSide("files"), setTimeout(() => explorer.current?.newIn(kind))),
            search: openSearch,
            sourceControl: () => (has.scm ? showSide("scm") : undefined),
            togglePanel: () => setTerm((v) => !v),
            newTerminal: () => (showPanel("terms"), setTimeout(() => panelApi.current?.newTerm(), 300)),
            problems: () => showPanel("problems"),
            environment: () => showPanel("env"),
            toggleSplit,
            toggleSidebar: () => setSidebar((v) => !v),
            toggleCoach: has.practice ? () => setCoach((c) => !c) : undefined,
            toggleMarkdown: () => setMdPreview((v) => !v),
            settings,
            setSettings,
            closeAll: () => open.forEach((o) => files$.close(o.path)),
            openInVscode: () => api.openEditor(tab.id, active ?? undefined, editorRef.current?.getPosition()?.lineNumber),
            openSettings: () => setShowSettings(true),
          })}
          onFile={(p) => openAny(p)}
          onLine={(n) => setTimeout(() => revealAt(n), 50)}
          onClose={() => setPalette(null)}
        />
      )}

      {setup && has.setup && (
        <SetupWizard
          tab={tab}
          onClose={() => setSetup(false)}
          onRun={async (chain) => {
            await api.newTerm(tab.id, { title: t("setup"), run: chain });
            showPanel("terms");
          }}
          onApplied={() => (diskChanged(), void loadPlugins())}
          onOnboard={() => draft(t("Use the nexo-onboard skill on this project: fill its AGENTS.md and context/."))}
        />
      )}

      {coach && has.practice && (
        <CoachPanel
          key={practice.plan?.title ?? "none"}
          tab={tab}
          plan={practice.plan}
          review={practice.review}
          current={practice.current}
          planning={practice.planning}
          validating={practice.validating}
          error={error}
          onMakePlan={practice.makePlan}
          onValidate={practice.validate}
          onOpenIssue={(file, line) => openAny(file, line)}
        />
      )}
      {!coach && error && <div className="toast" onClick={() => setError("")}>{error}</div>}
    </div>
  );
}
