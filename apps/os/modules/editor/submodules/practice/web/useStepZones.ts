// Práctica margins in Monaco: each step of a plan is a decoration ("zone") in its file, created from the plan's
// line numbers. Decorations move with the text, so margins inserted or code typed above never desync later steps.
import { useEffect, useRef } from "react";
import { monaco } from "../../../web/monaco";
import type { Plan, Review, Step } from "../../../web/api";

type Ed = monaco.editor.IStandaloneCodeEditor;

export function useStepZones(editor: { current: Ed | null }, plan: Plan | null, review: Review | null, stepId: string | null, active: string | null) {
  const inserted = useRef<Record<string, boolean>>({}); // insert-mode steps whose blank margin is already in the buffer
  const deco = useRef(new Map<string, string>()); // step id → decoration id in its file's model
  const pending = useRef<{ s: Step; p: Plan | null } | null>(null);

  const zoneOptions = (s: Step, on: boolean): monaco.editor.IModelDecorationOptions => ({
    isWholeLine: true,
    className: on ? "zone zone-on" : "zone",
    glyphMarginClassName: "zone-glyph",
    glyphMarginHoverMessage: { value: `**${s.id}** · ${s.goal}` },
    stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
  });

  function ensure(model: monaco.editor.ITextModel, p: Plan | null) {
    const path = model.uri.path.slice(1);
    for (const s of p?.steps ?? []) {
      if (s.file !== path || deco.current.has(s.id)) continue;
      const last = model.getLineCount();
      const a = Math.min(Math.max(1, s.line), last);
      const b = s.mode === "insert" ? a : Math.min(Math.max(s.endLine, a), last);
      const [id] = model.deltaDecorations([], [{ range: new monaco.Range(a, 1, b, 1), options: zoneOptions(s, false) }]);
      deco.current.set(s.id, id);
    }
  }

  /** Re-styles the zones of the file in the editor (current step brighter) and shows review issues as markers. */
  function paint(p: Plan | null = plan, currentId: string | null = stepId) {
    const ed = editor.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    const path = model.uri.path.slice(1);
    ensure(model, p);
    for (const s of p?.steps ?? []) {
      const id = deco.current.get(s.id);
      const range = id && s.file === path ? model.getDecorationRange(id) : null;
      if (!id || !range) continue;
      const [nid] = model.deltaDecorations([id], [{ range, options: zoneOptions(s, s.id === currentId) }]);
      deco.current.set(s.id, nid);
    }
    const issues = review?.steps.flatMap((r) => r.issues.filter((i) => i.file === path)) ?? [];
    monaco.editor.setModelMarkers(
      model,
      "practica",
      issues.map((i) => {
        const ln = Math.min(Math.max(1, i.line), model.getLineCount());
        return { severity: monaco.MarkerSeverity.Warning, message: i.msg, startLineNumber: ln, endLineNumber: ln, startColumn: 1, endColumn: model.getLineMaxColumn(ln) };
      }),
    );
  }

  /** Puts the step's margin in the editor buffer (not on disk), highlights it and moves the cursor there. */
  function apply(s: Step, p: Plan | null) {
    const ed = editor.current;
    const model = ed?.getModel();
    if (!ed || !model || model.uri.path.slice(1) !== s.file) return;
    ensure(model, p);
    const id = deco.current.get(s.id)!;
    let range = model.getDecorationRange(id)!;
    if (s.mode === "insert" && !inserted.current[s.id]) {
      inserted.current[s.id] = true;
      const at = range.startLineNumber;
      const indent = model.getLineContent(at).match(/^\s*/)?.[0] ?? "";
      ed.executeEdits("practica", [{ range: new monaco.Range(at, 1, at, 1), text: `${indent}\n${indent}\n${indent}\n` }]);
      // The zone is exactly the three blank lines just inserted.
      const [nid] = model.deltaDecorations([id], [{ range: new monaco.Range(at, 1, at + 2, 1), options: zoneOptions(s, true) }]);
      deco.current.set(s.id, nid);
      range = model.getDecorationRange(nid)!;
    }
    paint(p, s.id);
    const target = s.mode === "insert" ? range.startLineNumber + 1 : range.startLineNumber;
    ed.revealLineInCenter(target);
    ed.setPosition({ lineNumber: target, column: model.getLineMaxColumn(target) });
    ed.focus();
  }

  /** Applies the queued step once the editor actually shows that step's file (first mount or model swap). */
  function tryPending() {
    const pend = pending.current;
    const model = editor.current?.getModel();
    if (!pend || !model || model.uri.path.slice(1) !== pend.s.file) return;
    pending.current = null;
    apply(pend.s, pend.p);
  }

  useEffect(() => {
    const t = setTimeout(() => paint(), 80);
    return () => clearTimeout(t);
  }, [active, stepId, review, plan]);

  return {
    /** Queue step `s`; call after opening its file. */
    queue: (s: Step, p: Plan | null) => ((pending.current = { s, p }), tryPending()),
    tryPending,
    paint,
    /** New plan: forget every zone. */
    reset() {
      inserted.current = {};
      for (const m of monaco.editor.getModels()) m.deltaDecorations([...deco.current.values()], []);
      deco.current.clear();
    },
    /** Unsaved margins die with the file's model; the next visit re-creates them. */
    forgetFile(path: string) {
      for (const s of plan?.steps ?? []) if (s.file === path) (deco.current.delete(s.id), delete inserted.current[s.id]);
    },
  };
}
