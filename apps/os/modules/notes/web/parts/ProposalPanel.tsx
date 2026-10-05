// Propose features: an AI reads the notes (and the project, if it exists) and drafts features you can edit,
// untick or keep before saving them.
import { ListPlus, MessageCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { usd } from "@os/lib/format";
import { notesApi as api, type Note, type Proposal } from "../api";
import { t } from "@os/i18n";

type Draft = Proposal & { keep: boolean };

export function ProposalPanel({ toAnalyze, repoNames, onNotesChanged, onCreated, onError }: {
  toAnalyze: Note[]; // the ticked notes, or the open one
  repoNames: string[];
  onNotesChanged: () => void;
  onCreated: (project: string) => void;
  onError: (msg: string) => void;
}) {
  const [analysis, setAnalysis] = useState<{ project: string; exists: boolean; summary: string; cost: number } | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<"" | "analyze" | "create">("");
  const analyzeProjects = [...new Set(toAnalyze.map((n) => n.project))];

  async function analyze() {
    setBusy("analyze");
    try {
      const r = await api.analyzeNotes(toAnalyze.map((n) => n.id));
      setAnalysis({ project: r.project, exists: r.exists, summary: r.summary, cost: r.cost });
      setDrafts(r.proposals.map((p) => ({ ...p, keep: true })));
      onNotesChanged();
    } catch (e) {
      onError(t((e as Error).message));
    } finally {
      setBusy("");
    }
  }

  async function createFeatures() {
    if (!analysis) return;
    const keep = drafts.filter((d) => d.keep).map(({ keep: _k, ...p }) => p);
    if (!keep.length) return;
    setBusy("create");
    try {
      await api.accept(analysis.project, keep);
      setDrafts([]);
      setAnalysis(null);
      onCreated(analysis.project);
    } catch (e) {
      onError(t((e as Error).message));
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="coach-card">
        <div className="muted" style={{ fontSize: 13 }}>
          {toAnalyze.length === 0
            ? t("Open a note (or tick several of the same project) to analyze them.")
            : analyzeProjects.length === 1 && repoNames.includes(analyzeProjects[0]!)
              ? t("{n} note(s) of {project}. An AI reads them, looks at the project and proposes features.", { n: toAnalyze.length, project: analyzeProjects[0]! })
              : t("{n} note(s) of {project}. An AI reads them and proposes features.", { n: toAnalyze.length, project: analyzeProjects.join(", ") })}
        </div>
        <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} disabled={!toAnalyze.length || analyzeProjects.length > 1 || busy === "analyze"} onClick={analyze}>
          {busy === "analyze" ? <><span className="spin" /> {t("Analyzing… (~30-60 s)")}</> : <><Sparkles size={14} /> {t("Analyze {n} note(s)", { n: toAnalyze.length || "" })}</>}
        </button>
        {analyzeProjects.length > 1 && <div className="errline" style={{ marginTop: 6 }}>{t("Pick notes of a single project.")}</div>}
      </div>

      {analysis && (
        <div className="coach-card">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="eyebrow">{analysis.project} · {analysis.exists ? t("existing project") : t("new project")}</span>
            <span className="faint mono" style={{ fontSize: 11.5 }}>{usd(analysis.cost)}</span>
          </div>
          <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>{analysis.summary}</p>
        </div>
      )}

      {drafts.map((d, i) => {
        const up = (patch: Partial<Draft>) => setDrafts((prev) => prev.map((x, k) => (k === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className={`draft ${d.keep ? "" : "off"}`}>
            <div className="draft-head">
              <input type="checkbox" aria-label={t("Keep")} checked={d.keep} onChange={() => up({ keep: !d.keep })} />
              <input className="draft-title" aria-label={t("Title")} value={d.title} onChange={(e) => up({ title: e.target.value })} />
            </div>
            <div className="draft-meta">
              <select aria-label={t("Type")} value={d.type} onChange={(e) => up({ type: e.target.value as Draft["type"] })}>
                {["feature", "bug", "chore"].map((x) => <option key={x} value={x}>{t(x)}</option>)}
              </select>
              <select aria-label={t("Priority")} value={d.priority} onChange={(e) => up({ priority: e.target.value as Draft["priority"] })}>
                {["P0", "P1", "P2", "P3"].map((x) => <option key={x}>{x}</option>)}
              </select>
              <select aria-label={t("Size")} value={d.size} onChange={(e) => up({ size: e.target.value as Draft["size"] })}>
                {["S", "M", "L"].map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <textarea className="field draft-desc" aria-label={t("Description")} rows={3} value={d.description} onChange={(e) => up({ description: e.target.value })} />
            <textarea
              className="field draft-crit mono"
              rows={Math.max(2, d.criteria.length)}
              value={d.criteria.join("\n")}
              onChange={(e) => up({ criteria: e.target.value.split("\n") })}
              title={t("Acceptance criteria, one per line")} aria-label={t("Acceptance criteria, one per line")}
            />
            <div className="faint" style={{ fontSize: 12 }}><MessageCircle size={13} /> {d.why}</div>
          </div>
        );
      })}
      {drafts.length > 0 && (
        <div className="validate-bar">
          <button className="btn primary" disabled={busy === "create" || !drafts.some((d) => d.keep)} onClick={createFeatures}>
            {busy === "create" ? <span className="spin" /> : <ListPlus size={14} />} {t("Save {n} feature(s)", { n: drafts.filter((d) => d.keep).length })}
          </button>
        </div>
      )}
    </>
  );
}
