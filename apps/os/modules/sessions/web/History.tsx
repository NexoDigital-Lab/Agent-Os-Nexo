import { ExternalLink, RefreshCw } from "lucide-react";
import { ago, usd } from "@os/lib/format";
import type { HistoryItem, Tab } from "./api";
import { StatusGlyph } from "./tabs/StatusGlyph";
import { t } from "@os/i18n";

const sourceLabel = (s: string) => (s === "cli" ? "terminal" : s.startsWith("sdk") ? "agent-os" : s);

/** Last AI sessions (terminal + agent-os). One click resumes one in a tab. */
export function History({
  items,
  onResume,
  compact = false,
  tabs,
}: {
  items: HistoryItem[];
  onResume: (h: HistoryItem) => void;
  compact?: boolean;
  tabs?: Tab[]; // open tabs: a session open in one shows that tab's agent status
}) {
  if (!items.length) return <div className="faint" style={{ fontSize: 13, padding: 8 }}>{t("No recent sessions.")}</div>;
  return (
    <div className={`hist ${compact ? "compact" : ""}`}>
      {items.map((h) => {
        const open = h.tabId ? tabs?.find((t) => t.id === h.tabId) : undefined;
        const action = h.tabId ? t("Go to the tab") : h.active ? t("Resume (as a copy)") : t("Resume");
        return (
          <button
            key={h.id}
            className="hist-row"
            onClick={() => onResume(h)}
            title={`${h.title}\n${h.cwd ?? ""}\n${action}${h.active && !h.tabId ? ` — ${t("still live elsewhere, a branch opens")}` : ""}`}
          >
            {open && open.status !== "idle" ? <StatusGlyph tab={open} /> : <span className={`dot ${h.active ? "live" : ""}`} />}
            <span className="hist-main">
              <span className="hist-title">{h.title}</span>
              <span className="hist-meta">
                {h.project} · {sourceLabel(h.source)} · {h.active ? <b className="live-txt">{t("live")}</b> : ago(h.end)}
                {!compact && h.agents > 0 ? ` · ${t("{n} subagents", { n: h.agents })}` : ""}
              </span>
            </span>
            {!compact && <span className="num muted" style={{ fontSize: 12.5 }}>{usd(h.cost)}</span>}
            <span className={`hist-go ${h.tabId ? "open" : ""}`}>{h.tabId ? <ExternalLink size={14} /> : <RefreshCw size={14} />}</span>
          </button>
        );
      })}
    </div>
  );
}
