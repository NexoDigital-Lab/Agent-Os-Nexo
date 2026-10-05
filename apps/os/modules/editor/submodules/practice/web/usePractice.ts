// Práctica state of a workspace: the plan Claude made, its review, the current step, and the step margins
// (zones) in the editor. You write the code; Claude plans (makePlan) and reviews (validate).
import { useEffect, useState } from "react";
import { editorApi as api, type Plan, type Review, type Step, type Tab } from "../../../web/api";
import { useStepZones } from "./useStepZones";
import type { monaco } from "../../../web/monaco";
import { t } from "@os/i18n";

export function usePractice({ tab, editorRef, active, openFile, saveDirty, dirtyCount, onPlanned, onError }: {
  tab: Tab;
  editorRef: { current: monaco.editor.IStandaloneCodeEditor | null };
  active: string | null;
  openFile: (path: string, isNew?: boolean) => Promise<unknown>;
  saveDirty: () => Promise<void>;
  dirtyCount: number;
  onPlanned: () => void;
  onError: (msg: string) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "plan" | "validate">("");
  const zones = useStepZones(editorRef, plan, review, stepId, active);

  useEffect(() => {
    api.practice(tab.id).then((p) => {
      setPlan(p.plan);
      setReview(p.review);
      if (p.plan?.steps[0]) setStepId(p.plan.steps[0].id);
    });
  }, [tab.id]);

  async function goToStep(s: Step, p: Plan | null = plan) {
    setStepId(s.id);
    await openFile(s.file, s.isNew);
    zones.queue(s, p);
  }

  async function makePlan(task: string): Promise<boolean> {
    setBusy("plan");
    try {
      const p = await api.practicePlan(tab.id, task);
      setPlan(p);
      setReview(null);
      zones.reset();
      if (p.steps[0]) goToStep(p.steps[0], p);
      onPlanned();
      return true;
    } catch (e: any) {
      onError(e.message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function validate() {
    if (dirtyCount && confirm(t("{n} file(s) are unsaved. Save them before checking?", { n: dirtyCount }))) await saveDirty();
    setBusy("validate");
    try {
      setReview(await api.practiceValidate(tab.id));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy("");
    }
  }

  return {
    plan,
    review,
    stepId,
    current: plan?.steps.find((s) => s.id === stepId) ?? null,
    planning: busy === "plan",
    validating: busy === "validate",
    zones,
    goToStep,
    makePlan,
    validate,
  };
}

/** Stand-in when the practice submodule is off: no plan, nothing to paint. */
export function useNoPractice(_opts: Parameters<typeof usePractice>[0]): ReturnType<typeof usePractice> {
  const zones = { queue: () => {}, reset: () => {}, forgetFile: () => {}, tryPending: () => {}, paint: () => {} } as unknown as ReturnType<typeof usePractice>["zones"];
  return {
    plan: null,
    review: null,
    stepId: null,
    current: null,
    planning: false,
    validating: false,
    zones,
    goToStep: async () => {},
    makePlan: async () => false,
    validate: async () => {},
  };
}
