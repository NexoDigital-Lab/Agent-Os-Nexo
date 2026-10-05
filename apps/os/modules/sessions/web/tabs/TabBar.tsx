// The open tabs (one AI session each): status, project/worktree and cost, marks other modules add; double-click renames.
import { useEffect } from "react";
import { Plus, X } from "lucide-react";
import { usd } from "@os/lib/format";
import { slot } from "@os/registry";
import type { Tab } from "../api";
import type { TabBadge } from "../slots";
import { markSeen } from "./store";
import { StatusGlyph, WorkPill } from "./StatusGlyph";
import { t as i18n } from "@os/i18n";

export function TabBar({ tabs, active, onSelect, onRename, onClose, onNew }: {
  tabs: Tab[];
  active: string | null;
  onSelect: (id: string) => void;
  onRename: (t: Tab) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const badges = slot<TabBadge>("tab.badges");
  const tab = tabs.find((t) => t.id === active) ?? null;
  // The user is on this tab: whatever it finished or failed is no longer news (also when the window regains focus).
  const unseen = tab && (tab.status === "done" || tab.status === "error") ? tab.id : null;
  useEffect(() => {
    if (!unseen) return;
    const see = () => document.hasFocus() && document.visibilityState === "visible" && markSeen(unseen);
    see();
    window.addEventListener("focus", see);
    return () => window.removeEventListener("focus", see);
  }, [unseen]);
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div key={t.id} className={`tab ${tab?.id === t.id ? "on" : ""}`} onClick={() => onSelect(t.id)}>
          {badges.map((b) => <b.component key={b.id} tab={t} />)}
          {t.status === "idle" ? (t.running ? <span className="dot live" /> : <span className="dot" />) : <StatusGlyph tab={t} />}
          <div style={{ minWidth: 0 }}>
            <div
              className="t"
              onDoubleClick={() => onRename(t)}
            >
              {t.title}
            </div>
            <WorkPill tab={t} />
            <div className="p">{t.project}{t.worktree ? ` ↳ ${t.worktree}` : ""}{t.cost > 0 ? ` · ${usd(t.cost)}` : ""}</div>
          </div>
          <button className="x" aria-label={i18n("Close tab {name}", { name: t.title })} onClick={(e) => (e.stopPropagation(), onClose(t.id))}><X size={12} /></button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} title={i18n("New tab")} aria-label={i18n("New tab")}>
        <Plus size={14} />
      </button>
    </div>
  );
}
