// "chat.events" (ssh/plan): a plan the agent proposes for the SSH console. Approve once, not per command; the
// decision goes to /api/ssh/plans/:id and the server re-emits the event with the new status.
import { useState } from "react";
import { Check, KeyRound, X } from "lucide-react";
import { t } from "@os/i18n";
import { isLocked } from "@os/lib/http";
import { goTo } from "../../shell/web/nav";
import type { Ev, Tab } from "../../sessions/web/api";
import { sshApi, visibleChars, type SshPlan } from "./api";

export function SshPlanCard({ ev }: { tab: Tab; ev: Extract<Ev, { kind: "module" }> }) {
  const plan = ev.data as SshPlan;
  const [busy, setBusy] = useState(false); // stays on from the click until plan.status changes (reset only on error)
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");

  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    setLocked(false);
    try {
      await sshApi.decidePlan(ev.id, approve);
    } catch (e) {
      if (isLocked(e)) {
        setLocked(true);
        setError(t("Unlock the SSH vault to decide on this plan."));
      } else setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="perm ssh-plan" role="group" aria-label={t("Plan for the SSH console")}>
      <div className="ssh-plan-head">
        <b>{t("Plan for the SSH console")}</b>
        {plan.status !== "pending" && <span role="status" className={`pill ${plan.status === "approved" ? "ok" : "bad"}`}>{plan.status === "approved" ? t("Approved") : t("Rejected")}</span>}
      </div>
      <p className="ssh-plan-summary">{plan.summary}</p>
      <ol className="ssh-plan-steps">
        {plan.steps.map((s, i) => (
          <li key={i}>
            <pre className="mono">{visibleChars(s.command)}</pre>
            <div className="faint">{visibleChars(s.why)}</div>
          </li>
        ))}
      </ol>
      {plan.status === "pending" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary sm" disabled={busy} onClick={() => decide(true)}><Check size={14} /> {t("Approve plan")}</button>
          <button className="btn sm danger" disabled={busy} onClick={() => decide(false)}><X size={14} /> {t("Reject")}</button>
        </div>
      )}
      <div aria-live="polite">
        {error && <div className="errline" role="alert" style={{ marginTop: 8 }}>{error}</div>}
        {locked && (
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => goTo("ssh")}>
            <KeyRound size={14} /> {t("Open SSH accesses")}
          </button>
        )}
      </div>
    </div>
  );
}
