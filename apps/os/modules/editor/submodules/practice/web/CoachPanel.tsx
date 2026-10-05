// Práctica: the coach panel (ask for a plan, step card with the hint ladder, terminal tasks, Claude's review)
// and the step list shown above the file tree. Claude plans and reviews; you write the code.
import { Bone, CircleCheck, Compass, Lightbulb, Pointer, Target } from "lucide-react";
import { useState } from "react";
import { renderMarkdown } from "@os/lib/markdown";
import { editorApi as api, type Plan, type Review, type Step, type Tab } from "../../../web/api";
import { usd } from "@os/lib/format";
import { t as tr } from "@os/i18n";

type Level = 0 | 1 | 2 | 3 | 4; // 0 nothing · 1 pointer · 2 approach · 3 skeleton · 4 snippet

const STEP_DOT: Record<string, string> = { ok: "ok", partial: "warn", pending: "", problem: "bad" };
const VERDICT: Record<string, { label: string; cls: string }> = {
  done: { label: "Done!", cls: "ok" },
  almost: { label: "Almost", cls: "accent" },
  missing: { label: "Still missing", cls: "bad" },
};

/** Keyed by the plan in the workspace, so hints and snippets reset with each new plan. */
export function CoachPanel({ tab, plan, review, current, planning, validating, error, onMakePlan, onValidate, onOpenIssue }: {
  tab: Tab;
  plan: Plan | null;
  review: Review | null;
  current: Step | null;
  planning: boolean;
  validating: boolean;
  error: string;
  onMakePlan: (task: string) => Promise<boolean>;
  onValidate: () => void;
  onOpenIssue: (file: string, line: number) => void;
}) {
  const [task, setTask] = useState("");
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  const [termReveal, setTermReveal] = useState<Record<string, number>>({});
  const [snippetBusy, setSnippetBusy] = useState(false);
  const [snippetError, setSnippetError] = useState("");

  const submit = async () => {
    if (task.trim() && (await onMakePlan(task))) setTask("");
  };
  const stepReview = (id: string) => review?.steps.find((r) => r.id === id);
  const level = current ? levels[current.id] ?? 0 : 0;
  const bump = (s: Step, to: Level) => setLevels((p) => ({ ...p, [s.id]: Math.max(p[s.id] ?? 0, to) as Level }));

  async function askSnippet(s: Step) {
    setSnippetBusy(true);
    setSnippetError("");
    try {
      const r = await api.practiceSnippet(tab.id, s.id);
      setSnippets((p) => ({ ...p, [s.id]: r.text }));
      setLevels((p) => ({ ...p, [s.id]: 4 }));
    } catch (e: any) {
      setSnippetError(e.message);
    } finally {
      setSnippetBusy(false);
    }
  }

  return (
  <aside className="p-coach">
      {!plan ? (
        <div className="coach-card">
          <div className="eyebrow">{tr("Practice mode")}</div>
          <p className="muted" style={{ fontSize: 13 }}>{tr("Tell me what you want to do. I prepare the steps and hints; you write the code.")}</p>
          <textarea className="field" rows={4} placeholder={tr("e.g. add a button that copies every note…")} value={task} onChange={(e) => setTask(e.target.value)} />
          <button className="btn primary" style={{ marginTop: 8, width: "100%", justifyContent: "center" }} disabled={!task.trim() || planning} onClick={() => submit()}>
            {planning ? <><span className="spin" /> {tr("Preparing the practice… (~40 s)")}</> : <><Target size={14} /> {tr("Prepare the practice")}</>}
          </button>
        </div>
      ) : (
        <>
          {planning && <div className="coach-card"><span className="spin" /> {tr("Preparing a new practice…")}</div>}
          {current && (
            <div className="coach-card">
              <div className="eyebrow">{tr("Step {n} of {total}", { n: plan.steps.findIndex((s) => s.id === current.id) + 1, total: plan.steps.length })}</div>
              <h3 className="coach-goal">{current.goal}</h3>
              <p className="muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>{current.why}</p>
              <div className="mono faint" style={{ fontSize: 12 }}>{current.file} · {current.mode === "insert" ? tr("you write from L{line}", { line: current.line }) : tr("you rewrite L{from}–{to}", { from: current.line, to: current.endLine })}</div>

              <div className="ladder">
                <button className={`btn sm ${level >= 1 ? "" : "ghost"}`} onClick={() => bump(current, 1)}><Pointer size={14} /> {tr("Pointer")}</button>
                <button className={`btn sm ${level >= 2 ? "" : "ghost"}`} onClick={() => bump(current, 2)}><Compass size={14} /> Approach</button>
                <button className={`btn sm ${level >= 3 ? "" : "ghost"}`} onClick={() => bump(current, 3)}><Bone size={14} /> {tr("Skeleton")}</button>
                <button className={`btn sm ${level >= 4 ? "" : "ghost"}`} disabled={snippetBusy} onClick={() => askSnippet(current)}>
                  {snippetBusy ? <span className="spin" /> : <Lightbulb size={14} />} Snippet
                </button>
              </div>
              {level >= 1 && <div className="hint"><b>{tr("Pointer.")}</b> {current.pointer}</div>}
              {level >= 2 && <div className="hint"><b>Approach.</b> {current.approach}</div>}
              {level >= 3 && <pre className="hint code">{current.skeleton}</pre>}
              {level >= 4 && snippets[current.id] && <div className="hint md-hint" dangerouslySetInnerHTML={{ __html: renderMarkdown(snippets[current.id]) }} />}

              <div className="eyebrow" style={{ marginTop: 12 }}>{tr("For it to be right")}</div>
              <ul className="checks">{current.checks.map((c) => <li key={c}>{c}</li>)}</ul>

              {stepReview(current.id) && (
                <div className={`review-step ${stepReview(current.id)!.status}`}>
                  <b>{tr(stepReview(current.id)!.status)}</b> — {stepReview(current.id)!.feedback}
                  {stepReview(current.id)!.issues.map((i, k) => (
                    <div key={k} className="issue" onClick={() => onOpenIssue(i.file, i.line)}>
                      <span className="mono">{i.file}:{i.line}</span> {i.msg}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {plan.terminal.length > 0 && (
            <div className="coach-card">
              <div className="eyebrow">{tr("Terminal practice")}</div>
              {plan.terminal.map((t) => {
                const lv = termReveal[t.id] ?? 0;
                const r = review?.terminal.find((x) => x.id === t.id);
                return (
                  <div key={t.id} className="term-task">
                    <div><span className={`dot ${r ? STEP_DOT[r.status] : ""}`} /> {t.goal}</div>
                    {lv >= 1 && <div className="hint">{t.hint}</div>}
                    {lv >= 2 && <pre className="hint code">{t.command}</pre>}
                    {r && <div className="faint" style={{ fontSize: 12.5 }}>{r.feedback}</div>}
                    {lv < 2 && (
                      <button className="btn sm ghost" onClick={() => setTermReveal((p) => ({ ...p, [t.id]: lv + 1 }))}>
                        {lv === 0 ? tr("how?") : tr("show the command")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {review && (
            <div className="coach-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className={`pill ${VERDICT[review.verdict]!.cls}`}>{tr(VERDICT[review.verdict]!.label)}</span>
                <span className="faint mono" style={{ fontSize: 11.5 }}>{usd(review.cost)}</span>
              </div>
              <p style={{ fontSize: 13.5, margin: "8px 0" }}>{review.overall}</p>
              <div className="hint"><b>{tr("Next:")}</b> {review.next}</div>
            </div>
          )}

          <details className="coach-card new-plan">
            <summary className="eyebrow">{tr("Another practice")}</summary>
            <textarea className="field" rows={3} placeholder={tr("What do you want to practice now?")} value={task} onChange={(e) => setTask(e.target.value)} />
            <button className="btn sm primary" style={{ marginTop: 6 }} disabled={!task.trim() || planning} onClick={() => submit()}><Target size={14} /> {tr("Prepare")}</button>
          </details>
        </>
      )}
      {(error || snippetError) && <div className="errline" style={{ padding: "0 4px" }}>{tr(error || snippetError)}</div>}
      {plan && (
        <div className="validate-bar">
          <button className="btn primary" disabled={validating} onClick={onValidate}>
            {validating ? <><span className="spin" /> {tr("Checking your code…")}</> : <><CircleCheck size={14} /> {tr("Check")}</>}
          </button>
          <span className="faint" style={{ fontSize: 11.5 }}>{tr("The AI checks the diff and git against the plan. It changes nothing.")}</span>
        </div>
      )}
    </aside>
  );
}

export function PlanSteps({ plan, review, stepId, onStep, onTerminal }: { plan: Plan; review: Review | null; stepId: string | null; onStep: (s: Step) => void; onTerminal: () => void }) {
  return (
    <>
      <div className="eyebrow p-sec">{tr("Steps")} · {plan.title}</div>
      {plan.steps.map((s, i) => {
        const r = review?.steps.find((x) => x.id === s.id);
        return (
          <div key={s.id} className={`p-step ${stepId === s.id ? "on" : ""}`} onClick={() => onStep(s)}>
            <span className={`dot ${r ? STEP_DOT[r.status] : ""}`} />
            <div className="p-step-body">
              <div className="p-step-goal">{i + 1}. {s.goal}</div>
              <div className="p-step-file mono">{s.file}{s.isNew ? ` · ${tr("new")}` : ` · L${s.line}`}</div>
            </div>
          </div>
        );
      })}
      {plan.terminal.length > 0 && <div className="eyebrow p-sec">{tr("Terminal")}</div>}
      {plan.terminal.map((t) => {
        const r = review?.terminal.find((x) => x.id === t.id);
        return (
          <div key={t.id} className="p-step term" onClick={onTerminal}>
            <span className={`dot ${r ? STEP_DOT[r.status] : ""}`} />
            <div className="p-step-body"><div className="p-step-goal">$ {t.goal}</div></div>
          </div>
        );
      })}
    </>
  );
}
