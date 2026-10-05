// The left rail: one button per view the active modules provide, their badges, and the footer items.
import { Minus, Plus } from "lucide-react";
import { t } from "@os/i18n";
import { slot, type ViewDef } from "@os/registry";
import type { RailItem } from "./slots";
import { useZoom } from "./zoom";

function RailButton({ v, on, onClick }: { v: ViewDef; on: boolean; onClick: () => void }) {
  const badge = v.useBadge?.() ?? null;
  const I = v.icon;
  const label = t(v.label);
  return (
    <button className={on ? "on" : ""} onClick={onClick} title={label} aria-label={label} aria-current={on ? "page" : undefined}>
      <I size={20} strokeWidth={1.8} />
      {badge !== null && badge > 0 && <span className="rail-badge" aria-label={t("{n} waiting for you", { n: badge })}>{badge}</span>}
    </button>
  );
}

export function Rail({ views, view, setView }: { views: ViewDef[]; view: string; setView: (v: string) => void }) {
  const zoom = useZoom();
  const footer = slot<RailItem>("rail.footer").sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const top = views.filter((v) => (v.order ?? 100) < 900);
  const bottom = views.filter((v) => (v.order ?? 100) >= 900);
  return (
    <nav className="rail" aria-label={t("Views")}>
      <div className="logo" aria-hidden>N</div>
      {top.map((v) => <RailButton key={v.id} v={v} on={view === v.id} onClick={() => setView(v.id)} />)}
      <div className="spacer" />
      {zoom.enabled && (
        <div className="zoom" title={t("Zoom: Ctrl + / Ctrl − / Ctrl 0")}>
          <button onClick={() => zoom.set(zoom.zoom + 0.1)} aria-label={t("Zoom in")}><Plus size={14} /></button>
          <button className="pct" onClick={() => zoom.set(1)} aria-label={t("Reset zoom ({pct}%)", { pct: Math.round(zoom.zoom * 100) })}>{Math.round(zoom.zoom * 100)}%</button>
          <button onClick={() => zoom.set(zoom.zoom - 0.1)} aria-label={t("Zoom out")}><Minus size={14} /></button>
        </div>
      )}
      {footer.map((f) => <f.component key={f.id} />)}
      {bottom.map((v) => <RailButton key={v.id} v={v} on={view === v.id} onClick={() => setView(v.id)} />)}
    </nav>
  );
}
