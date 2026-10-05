// 🧙 Configurar proyecto: a few questions, only the ones that apply to this repo (stack, toolchains, dependencies,
// .env, editor, context), then the exact plan. "Aplicar" writes the files and runs the commands in a visible
// terminal of the panel, where you can watch or stop them.
import { ArrowLeft, ArrowRight, Check, Play, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { editorApi as api, type SetupAnalysis, type SetupBody, type SetupPlan, type Tab } from "../../../web/api";
import { toggled } from "@os/lib/ui";
import { t as tr } from "@os/i18n";

type StepId = "stack" | "tools" | "deps" | "env" | "editor" | "context" | "plan";
const SECRET = /SECRET|TOKEN|PASSWORD|PASS|KEY|PRIVATE/i;

export function SetupWizard({ tab, onClose, onRun, onApplied, onOnboard }: {
  tab: Tab;
  onClose: () => void;
  onRun: (chain: string) => Promise<void>;
  onApplied: () => void;
  onOnboard: () => void;
}) {
  const [a, setA] = useState<SetupAnalysis | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<StepId>("stack");

  // answers
  const [recipe, setRecipe] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [tools, setTools] = useState<Set<string>>(new Set());
  const [deps, setDeps] = useState<Set<string>>(new Set());
  const [env, setEnv] = useState<Record<string, string>>({});
  const [exts, setExts] = useState<Set<string>>(new Set());
  const [installExt, setInstallExt] = useState(false);
  const [writeVscode, setWriteVscode] = useState(false);
  const [addRun, setAddRun] = useState(true);
  const [onboard, setOnboard] = useState(false);

  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SetupPlan | null>(null);

  useEffect(() => {
    api.setupAnalyze(tab.id).then(
      (r) => {
        setA(r);
        setDeps(new Set(r.deps.map((d) => d.cmd)));
        setEnv(Object.fromEntries(r.env.keys.map((k) => [k.key, k.current ?? k.value])));
        setOnboard(r.contextThin);
      },
      (e) => setError(e.message),
    );
  }, [tab.id]);

  const chosen = a?.recipes.find((r) => r.id === recipe) ?? null;
  const stackRecipes = useMemo(() => (a ? (chosen ? [chosen] : a.recipes.filter((r) => a.detected.some((d) => d.id === r.id))) : []), [a, chosen]);

  // Toolchains this project needs: the chosen/detected recipes' plus what Entorno already flags.
  const neededTools = useMemo(() => {
    if (!a) return [];
    const keys = new Set(stackRecipes.flatMap((r) => r.toolchains));
    return a.toolchains.filter((t) => keys.has(t.key) || (t.needed && t.key !== "git"));
  }, [a, stackRecipes]);
  const extChoices = useMemo(() => {
    if (!a) return [];
    const fromRecipes = stackRecipes.flatMap((r) => r.extensions.map((id) => ({ id, why: tr("for {name}", { name: r.name }) })));
    const rules = a.extensions.recommended.map((r) => ({ id: r.id, why: r.why }));
    return [...fromRecipes, ...rules].filter((e, i, all) => all.findIndex((x) => x.id === e.id) === i && !a.extensions.current.includes(e.id));
  }, [a, stackRecipes]);

  // Defaults follow the stack: missing tools and its extensions start ticked.
  useEffect(() => {
    setTools(new Set(neededTools.filter((t) => !t.installed).map((t) => t.key)));
  }, [neededTools]);
  useEffect(() => {
    setExts(new Set(extChoices.map((e) => e.id)));
  }, [extChoices]);
  useEffect(() => {
    if (chosen) setAnswers(Object.fromEntries(chosen.questions.map((q) => [q.id, q.default])));
  }, [chosen?.id]);

  const steps: { id: StepId; label: string }[] = !a
    ? []
    : [
        { id: "stack" as const, label: a.empty ? tr("What you'll build") : "Stack" },
        ...(neededTools.some((t) => !t.installed) ? [{ id: "tools" as const, label: "Toolchains" }] : []),
        ...(a.deps.length && !a.empty ? [{ id: "deps" as const, label: tr("Dependencies") }] : []),
        ...(a.env.keys.length ? [{ id: "env" as const, label: tr(".env variables") }] : []),
        { id: "editor" as const, label: "Editor" },
        { id: "context" as const, label: tr("Context") },
        { id: "plan" as const, label: tr("Summary") },
      ];
  const idx = steps.findIndex((s) => s.id === step);

  const body = (): SetupBody => ({
    recipe: recipe ?? undefined,
    answers,
    toolchains: [...tools],
    deps: a?.empty ? [] : [...deps],
    env: a?.env.keys.length ? env : undefined,
    extensions: [...exts],
    installExtensions: installExt,
    writeVscode,
    addRun,
  });

  async function go(to: StepId) {
    setError("");
    if (to === "plan") {
      setBusy(true);
      try {
        setPlan(await api.setupPlan(tab.id, body()));
      } catch (e: any) {
        return setError(e.message);
      } finally {
        setBusy(false);
      }
    }
    setStep(to);
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await api.setupApply(tab.id, body());
      if (r.chain) await onRun(r.chain);
      onApplied();
      setDone(r);
      if (onboard) onOnboard();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => setter(toggled(set, v));

  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <div className="modal wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wiz-head">
          <h3><WandSparkles size={16} /> {tr("Set up {project}", { project: tab.project })}</h3>
          <button className="linkish" disabled={busy} onClick={onClose}>{tr("close")}</button>
        </div>

        {!a ? (
          <p className="faint">{error ? tr(error) : <><span className="spin" /> {tr("Looking at the repository…")}</>}</p>
        ) : done ? (
          <>
            <p style={{ margin: 0 }}>{done.commands.length ? tr("Done. What was written is on disk; the commands are running in the panel's \"setup\" terminal.") : tr("Done. What was written is on disk.")}</p>
            <ul className="checks" style={{ color: "var(--ok)" }}>
              {done.writes.map((w) => <li key={w.path}><span className="mono">{w.path}</span> — {tr(w.what)}</li>)}
            </ul>
            {done.commands.some((c) => c.cmd.startsWith("sudo")) && <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>{tr("The terminal will ask for your password for the sudo steps.")}</p>}
            {onboard && <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>{tr("The nexo-onboard request is ready in the Chat for when you want to send it.")}</p>}
            <div className="wiz-foot"><span /><button className="btn primary" onClick={onClose}>{tr("Close")}</button></div>
          </>
        ) : (
          <>
            <div className="wiz-steps">
              {steps.map((s, i) => (
                <button key={s.id} className={`${s.id === step ? "on" : ""} ${i < idx ? "past" : ""}`} disabled={i > idx || busy} onClick={() => go(s.id)}>
                  <span className="n">{i < idx ? <Check size={12} /> : i + 1}</span> {s.label}
                </button>
              ))}
            </div>

            <div className="wiz-body">
              {step === "stack" &&
                (a.empty ? (
                  <>
                    <p className="wiz-q">{tr("The repository is empty. What are you going to build? I set up the base.")}</p>
                    <div className="recipe-grid">
                      {a.recipes.filter((r) => r.scaffold).map((r) => (
                        <button key={r.id} className={`recipe ${recipe === r.id ? "on" : ""}`} onClick={() => setRecipe(recipe === r.id ? null : r.id)}>
                          <b>{r.name}</b>
                          <span>{tr(r.desc)}</span>
                        </button>
                      ))}
                    </div>
                    {chosen?.questions.map((q) => (
                      <label key={q.id} className="wiz-field">
                        <span>{tr(q.label)}{q.hint && <span className="faint"> · {tr(q.hint)}</span>}</span>
                        {q.type === "text" && <input className="field mono" value={String(answers[q.id] ?? "")} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}
                        {q.type === "bool" && <input type="checkbox" checked={!!answers[q.id]} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.checked })} />}
                        {q.type === "choice" && (
                          <div className="seg">
                            {q.options!.map((o) => <button type="button" key={o.value} className={answers[q.id] === o.value ? "on" : ""} onClick={() => setAnswers({ ...answers, [q.id]: o.value })}>{tr(o.label)}</button>)}
                          </div>
                        )}
                      </label>
                    ))}
                    {!recipe && <p className="faint" style={{ fontSize: 12.5 }}>{tr("Or continue without a template: I only set up the rest.")}</p>}
                  </>
                ) : (
                  <>
                    <p className="wiz-q">{tr("This is what I found in the repository:")}</p>
                    {a.detected.length ? (
                      <ul className="checks">{a.detected.map((d) => <li key={d.id}><b>{d.name}</b> <span className="faint">— {tr(d.evidence)}</span></li>)}</ul>
                    ) : (
                      <p className="faint">{tr("I didn't recognize the stack. I can still help with the environment variables and the editor.")}</p>
                    )}
                  </>
                ))}

              {step === "tools" && (
                <>
                  <p className="wiz-q">{tr("Install what's missing?")}</p>
                  {neededTools.map((t) => (
                    <label key={t.key} className={`wiz-check ${t.installed ? "off" : ""}`}>
                      <input type="checkbox" disabled={t.installed || !t.install} checked={t.installed || tools.has(t.key)} onChange={() => toggle(tools, setTools, t.key)} />
                      <span><b>{t.name}</b> {t.installed ? <span className="faint"><Check size={12} /> {t.version}</span> : <span className="mono faint">{t.install}</span>}</span>
                    </label>
                  ))}
                  {neededTools.every((t) => t.installed) && <p className="faint">{tr("You have everything installed")} <Check size={14} /></p>}
                </>
              )}

              {step === "deps" && (
                <>
                  <p className="wiz-q">{tr("Install the project's dependencies?")}</p>
                  {a.deps.map((d) => (
                    <label key={d.cmd} className="wiz-check">
                      <input type="checkbox" checked={deps.has(d.cmd)} onChange={() => toggle(deps, setDeps, d.cmd)} />
                      <span>{tr(d.label)} <span className="mono faint">{d.cmd}</span></span>
                    </label>
                  ))}
                </>
              )}

              {step === "env" && (
                <>
                  <p className="wiz-q">{tr("Fill in the")} <span className="mono">.env</span> ({tr("from")} <span className="mono">{a.env.file}</span>; {tr("it stays out of git")}).</p>
                  <div className="env-grid">
                    {a.env.keys.map((k) => (
                      <label key={k.key} className="wiz-field">
                        <span className="mono">{k.key}{k.current !== null && <span className="faint"> · {tr("already has a value")}</span>}</span>
                        <input className="field mono" type={SECRET.test(k.key) ? "password" : "text"} value={env[k.key] ?? ""} placeholder={k.value} onChange={(e) => setEnv({ ...env, [k.key]: e.target.value })} />
                        {k.comment && <span className="faint hint">{k.comment}</span>}
                      </label>
                    ))}
                  </div>
                </>
              )}

              {step === "editor" && (
                <>
                  <p className="wiz-q">{tr("Extensions for this project")}</p>
                  {extChoices.length === 0 && <p className="faint">{tr("Nothing new to recommend.")}</p>}
                  {extChoices.map((e) => (
                    <label key={e.id} className="wiz-check">
                      <input type="checkbox" checked={exts.has(e.id)} onChange={() => toggle(exts, setExts, e.id)} />
                      <span><span className="mono">{e.id}</span> <span className="faint">— {e.why}</span></span>
                    </label>
                  ))}
                  <div className="wiz-opts">
                    <label><input type="checkbox" checked={installExt} onChange={(e) => setInstallExt(e.target.checked)} /> {tr("Also install them in VS Code")}</label>
                    <label><input type="checkbox" checked={writeVscode} onChange={(e) => setWriteVscode(e.target.checked)} /> {tr("Write")} <span className="mono">.vscode/extensions.json</span> {tr("in the repository")}</label>
                    {chosen && <label><input type="checkbox" checked={addRun} onChange={(e) => setAddRun(e.target.checked)} /> {tr("Add the {name} commands to", { name: chosen.name })} <Play size={12} /> Run</label>}
                  </div>
                </>
              )}

              {step === "context" && (
                <>
                  <p className="wiz-q">{tr("Context for the agent")}</p>
                  <label className="wiz-check">
                    <input type="checkbox" checked={onboard} onChange={(e) => setOnboard(e.target.checked)} />
                    <span>
                      {tr("Leave a nexo-onboard request ready in the Chat when this ends")}
                      <span className="faint"> — {tr("it fills the project's AGENTS.md and context/ so agents know the project (uses tokens; you send it).")} {a.contextThin ? tr("Today the context is almost empty.") : tr("There is context already; it refreshes it.")}</span>
                    </span>
                  </label>
                </>
              )}

              {step === "plan" && plan && (
                <>
                  <p className="wiz-q">{tr("This is what will happen:")}</p>
                  {plan.writes.length > 0 && (
                    <>
                      <div className="eyebrow">{tr("Files (written now)")}</div>
                      <ul className="checks">{plan.writes.map((w) => <li key={w.path}><span className="mono">{w.path}</span> — {tr(w.what)}</li>)}</ul>
                    </>
                  )}
                  {plan.commands.length > 0 && (
                    <>
                      <div className="eyebrow">{tr("Commands (in a panel terminal, in order; it stops if one fails)")}</div>
                      <ol className="wiz-cmds">{plan.commands.map((c, i) => <li key={i}><span>{tr(c.label)}</span><code>{c.cmd}</code></li>)}</ol>
                    </>
                  )}
                  {!plan.writes.length && !plan.commands.length && !onboard && <p className="faint">{tr("Nothing to do with what you chose.")}</p>}
                </>
              )}
            </div>

            {error && <div className="errline">{tr(error)}</div>}
            <div className="wiz-foot">
              <button className="btn ghost" disabled={idx <= 0 || busy} onClick={() => go(steps[idx - 1].id)}><ArrowLeft size={14} /> {tr("Back")}</button>
              {step === "plan" ? (
                <button className="btn primary" disabled={busy || (!plan?.writes.length && !plan?.commands.length && !onboard)} onClick={apply}>
                  {busy ? <><span className="spin" /> {tr("Applying…")}</> : <><Check size={14} /> {tr("Apply")}</>}
                </button>
              ) : (
                <button className="btn primary" disabled={busy} onClick={() => go(steps[idx + 1].id)}>
                  {busy ? <span className="spin" /> : <>{tr("Next")} <ArrowRight size={14} /></>}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
