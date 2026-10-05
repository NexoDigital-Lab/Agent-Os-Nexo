// The agent-status glyph of a tab (working / needs you / done / error) and the pill with the work status the agent set.
import { CircleAlert, CircleCheck, CircleX, Loader2 } from "lucide-react";
import type { AgentStatus, Tab } from "../api";
import { t } from "@os/i18n";

/** Label for a status glyph's tooltip / aria-label; null when there is nothing to show. */
export const STATUS_LABEL: Record<AgentStatus, string | null> = {
  idle: null,
  working: "Working",
  needs_you: "Needs you",
  done: "Finished",
  error: "Finished with an error",
};

export function StatusGlyph({ tab, size = 13 }: { tab: Pick<Tab, "status">; size?: number }) {
  const key = STATUS_LABEL[tab.status];
  if (!key) return null;
  const label = t(key);
  const I = { working: Loader2, needs_you: CircleAlert, done: CircleCheck, error: CircleX, idle: null }[tab.status]!;
  return (
    <span className={`ag-status ${tab.status}`} title={label} role="img" aria-label={label}>
      <I size={size} aria-hidden="true" />
    </span>
  );
}

export function WorkPill({ tab }: { tab: Pick<Tab, "workStatus"> }) {
  const w = tab.workStatus;
  if (!w) return null;
  return (
    <span className={`work-pill ${w.status}`} title={w.note || t(w.status)} aria-label={t("Work status: {status}", { status: t(w.status) }) + (w.note ? `. ${w.note}` : "")}>
      {t(w.status)}
    </span>
  );
}
