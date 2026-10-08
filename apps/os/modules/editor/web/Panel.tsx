import { Check, CircleX, Container, Play, Plus, RefreshCw, SquareTerminal, TriangleAlert, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "../submodules/terminal/web/Terminal";
import { ProblemParser, type Problem } from "./problems";
import { editorApi as api, type RunCmd, type Tab, type TermInfo, type ToolStatus } from "./api";
import { t as tr } from "@os/i18n";

/** What the panel needs of the project's dev container (docker module), when it has one. */
export type ContainerInfo = { config: unknown; state: string };

export type PanelView = "terms" | "problems" | "env";
export type PanelApi = { run: (cmd: string) => void; newTerm: () => void };

/**
 * Bottom panel of the editor, like VS Code's: several terminals (they live on the server, so hiding the panel or
 * going to Chat doesn't kill them), Problems scraped from their output, and Entorno (toolchains for this project).
 */
export function Panel({ tab, view, setView, height, onClose, problems: problemsProp, setProblems: setProblemsProp, onOpenProblem, apiRef, devenv, focusTerm, terminals = true }: {
  tab: Tab;
  view: PanelView;
  setView: (v: PanelView) => void;
  height?: number; // omitted: fill the parent (the tab's Terminal view)
  onClose?: () => void;
  problems?: Record<string, Problem[]>; // omitted: the panel keeps its own (the tab's Terminal view)
  setProblems?: (fn: (p: Record<string, Problem[]>) => Record<string, Problem[]>) => void;
  onOpenProblem?: (p: Problem) => void;
  apiRef: { current: PanelApi | null };
  devenv?: ContainerInfo | null;
  /** False when the terminal submodule is off. */
  terminals?: boolean; // the project's dev container, when it has one: adds a "terminal inside" button
  focusTerm?: string; // a terminal created elsewhere (e.g. install deps): reload the list and select it
}) {
  const [terms, setTerms] = useState<TermInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [error, setError] = useState("");
  const [ownProblems, setOwnProblems] = useState<Record<string, Problem[]>>({});
  const problems = problemsProp ?? ownProblems;
  const setProblems = setProblemsProp ?? setOwnProblems;
  const parsers = useRef(new Map<string, ProblemParser>());

  const load = async (pick?: string) => {
    const list = await api.terms(tab.id);
    setTerms(list);
    setActive((a) => pick ?? (a && list.some((t) => t.id === a) ? a : list[list.length - 1]?.id ?? null));
    return list;
  };

  async function newTerm(body: { run?: string; title?: string; where?: "host" | "container" } = {}) {
    setError("");
    try {
      const t = await api.newTerm(tab.id, body);
      await load(t.id);
      setView("terms");
    } catch (e: any) {
      setError(e.message);
    }
  }

  apiRef.current = { run: (cmd) => newTerm({ run: cmd }), newTerm: () => newTerm() };

  useEffect(() => {
    load().then((list) => {
      if (!list.length) newTerm(); // first open: one shell ready
    });
  }, [tab.id]);

  useEffect(() => {
    if (focusTerm) load(focusTerm).then(() => setView("terms"), (e) => setError(e.message));
  }, [focusTerm]);

  useEffect(() => {
    if (view === "env" && !tools) api.toolchains(tab.id).then(setTools, (e) => setError(e.message));
  }, [view]);

  async function close(id: string) {
    await api.killTerm(tab.id, id);
    parsers.current.delete(id);
    setProblems(({ [id]: _gone, ...rest }) => rest);
    load();
  }

  const parser = (id: string) => {
    let p = parsers.current.get(id);
    if (!p) parsers.current.set(id, (p = new ProblemParser(tab.cwd)));
    return p;
  };
  const all = Object.values(problems).flat();
  const errors = all.filter((p) => p.severity === "error").length;

  async function install(t: ToolStatus) {
    if (!t.install) return;
    const term = await api.newTerm(tab.id, { title: `instalar ${t.key}` });
    await load(term.id);
    setView("terms");
    // Typed, not run: you read it and press Enter (sudo asks for your password there).
    await api.termInput(tab.id, term.id, t.install);
  }

  return (
    <div className={`panel ${height ? "" : "full"}`} style={height ? { height } : undefined}>
      <div className="panel-head">
        <div className="panel-tabs">
          <button className={view === "terms" ? "on" : ""} onClick={() => setView("terms")}><SquareTerminal size={14} /> {tr("Terminals")}{terms.length > 1 ? ` · ${terms.length}` : ""}</button>
          <button className={view === "problems" ? "on" : ""} onClick={() => setView("problems")}>
            <TriangleAlert size={14} /> {tr("Problems")} {all.length > 0 && <span className={`pill ${errors ? "bad" : ""}`}>{all.length}</span>}
          </button>
          <button className={view === "env" ? "on" : ""} onClick={() => setView("env")}><Wrench size={14} /> {tr("Environment")}</button>
        </div>
        {view === "terms" && terminals && (
          <div className="term-list">
            {terms.map((t) => (
              <span key={t.id} className={`term-chip ${active === t.id ? "on" : ""}`} onClick={() => setActive(t.id)} title={t.title}>
                {t.title}
                <button title={tr("Close this terminal (kills the process)")} aria-label={tr("Close this terminal (kills the process)")} onClick={(e) => { e.stopPropagation(); close(t.id); }}><X size={12} /></button>
              </span>
            ))}
            <button className="term-add" title={tr("New terminal")} aria-label={tr("New terminal")} onClick={() => newTerm()}><Plus size={14} /></button>
            {/* a stopped container is fine: the `ctr` shim starts it */}
            {!!devenv?.config && (devenv.state === "running" || devenv.state === "stopped") && (
              <button className="term-add" title={tr("New terminal inside the container")} aria-label={tr("New terminal inside the container")} onClick={() => newTerm({ where: "container" })}><Container size={14} /></button>
            )}
          </div>
        )}
        {view === "problems" && all.length > 0 && (
          <button className="linkish" style={{ marginLeft: 8 }} onClick={() => { setProblems(() => ({})); parsers.current.forEach((p) => p.reset()); }}>{tr("clear")}</button>
        )}
        {onClose && <span className="faint panel-hint">{tr("Ctrl+` show/hide")}</span>}
        {onClose && <button className="panel-x" title={tr("Hide the panel (terminals keep running)")} aria-label={tr("Hide the panel (terminals keep running)")} onClick={onClose}><X size={14} /></button>}
      </div>
      {error && <div className="errline" style={{ padding: "4px 10px" }}>{error}</div>}

      <div className="panel-body" style={{ display: view === "terms" ? "block" : "none" }}>
        {!terminals ? (
          <div className="faint" style={{ padding: 12, fontSize: 13 }}>{tr("The terminal submodule is off: turn it on in Modules.")}</div>
        ) : terms.length === 0 && <div className="faint" style={{ padding: 12, fontSize: 13 }}>{tr("No terminals.")} <Plus size={13} /> {tr("to open one.")}</div>}
        {terms.map((t) => (
          <div key={t.id} className="term-pane" style={{ display: active === t.id ? "block" : "none" }}>
            <Terminal
              tabId={tab.id}
              termId={t.id}
              onReset={() => {
                parser(t.id).reset();
                setProblems((p) => ({ ...p, [t.id]: [] }));
              }}
              onInput={(d) => {
                // Enter = a new command: its errors replace the previous run's.
                if (d.includes("\r")) setProblems((p) => ({ ...p, [t.id]: [] }));
              }}
              onOutput={(text) => {
                const found = parser(t.id).feed(text);
                if (found.length) setProblems((p) => ({ ...p, [t.id]: [...(p[t.id] ?? []), ...found].slice(-300) }));
              }}
              onExit={() => load()}
            />
          </div>
        ))}
      </div>

      {view === "problems" && (
        <div className="panel-body problems">
          {all.length === 0 ? (
            <div className="faint" style={{ padding: 12, fontSize: 13 }}>{tr("No problems. Errors with file:line printed in the terminals (go build, tsc, eslint…) show up here and in the editor.")}</div>
          ) : (
            all.map((p, i) => (
              <div key={i} className="problem" onClick={() => onOpenProblem?.(p)}>
                <span className={p.severity === "error" ? "sev-err" : "sev-warn"}>{p.severity === "error" ? <CircleX size={14} /> : <TriangleAlert size={14} />}</span>
                <span className="msg">{p.message}</span>
                <span className="mono faint loc">{p.file}:{p.line}:{p.col}</span>
                <span className="faint src">{p.source}</span>
              </div>
            ))
          )}
        </div>
      )}

      {view === "env" && (
        <div className="panel-body env">
          {!tools ? (
            <div className="faint" style={{ padding: 12, fontSize: 13 }}><span className="spin" /> {tr("Checking what you have installed…")}</div>
          ) : (
            <>
              {[...tools]
                .sort((a, b) => Number(b.needed) - Number(a.needed) || Number(a.installed) - Number(b.installed))
                .map((t) => (
                  <div key={t.key} className={`tool ${t.needed && !t.installed ? "missing" : ""}`}>
                    <span className="tool-dot">{t.installed ? <Check size={14} /> : t.needed ? <CircleX size={14} /> : "·"}</span>
                    <div className="tool-main">
                      <b>{t.name}</b> {t.version && <span className="mono faint">{t.version}</span>}
                      <div className="faint" style={{ fontSize: 11.5 }}>{t.needed ? tr("needed by: {what}", { what: t.neededBy === "every project" ? tr("every project") : (t.neededBy ?? "") }) : t.installed ? tr("installed (this project doesn't use it yet)") : tr("not installed · this project doesn't use it yet")}</div>
                    </div>
                    {!t.installed && t.install && (
                      <button className="btn sm" title={tr("Types into a new terminal: {cmd} (you run it with Enter)", { cmd: t.install })} onClick={() => install(t)}>
                        {tr("Install…")}
                      </button>
                    )}
                  </div>
                ))}
              <button className="linkish" style={{ margin: "8px 12px" }} onClick={() => { setTools(null); api.toolchains(tab.id).then(setTools); }}><RefreshCw size={14} /> {tr("check again")}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** ▶ Run: the project's commands (detected + yours). Each run opens its own terminal. */
export function RunMenu({ tab, onRun }: { tab: Tab; onRun: (cmd: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cmds, setCmds] = useState<RunCmd[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", cmd: "" });
  const load = () => api.runConfigs(tab.id).then(setCmds, () => setCmds([]));

  useEffect(() => {
    if (!open) return;
    load();
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const own = (cmds ?? []).filter((c) => c.source === "own");
  const saveOwn = async (next: { label: string; cmd: string }[]) => {
    await api.saveRun(tab.id, next);
    load();
  };

  return (
    <span className="run-menu" onClick={(e) => e.stopPropagation()}>
      <button className="btn sm run-btn" title={tr("Run a project command")} onClick={() => setOpen(!open)}><Play size={14} /> Run</button>
      {open && (
        <div className="run-drop">
          {!cmds && <div className="faint" style={{ padding: 8 }}><span className="spin" /></div>}
          {cmds?.length === 0 && <div className="faint" style={{ padding: "8px 10px", fontSize: 12.5 }}>{tr("No commands detected. Add one below.")}</div>}
          {cmds?.map((c) => (
            <div key={c.source + c.cmd} className="run-item">
              <button onClick={() => { setOpen(false); onRun(c.cmd); }} title={c.cmd}>
                <span><Play size={12} /> {c.label}</span>
                {c.label !== c.cmd && <span className="mono faint">{c.cmd}</span>}
              </button>
              {c.source === "own" && <button className="run-del" title={tr("Remove this command")} aria-label={tr("Remove this command")} onClick={() => saveOwn(own.filter((o) => o.cmd !== c.cmd))}><X size={12} /></button>}
            </div>
          ))}
          {adding ? (
            <form
              className="run-add"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draft.cmd.trim()) return;
                await saveOwn([...own, draft]);
                setDraft({ label: "", cmd: "" });
                setAdding(false);
              }}
            >
              <input className="field mono" autoFocus placeholder={tr("command, e.g. go run ./cmd/api")} aria-label={tr("command, e.g. go run ./cmd/api")} value={draft.cmd} onChange={(e) => setDraft({ ...draft, cmd: e.target.value })} />
              <input className="field" placeholder={tr("name (optional)")} aria-label={tr("name (optional)")} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              <button className="btn sm primary">{tr("Save")}</button>
            </form>
          ) : (
            <button className="run-new" onClick={() => setAdding(true)}><Plus size={14} /> {tr("Add a command…")}</button>
          )}
        </div>
      )}
    </span>
  );
}
