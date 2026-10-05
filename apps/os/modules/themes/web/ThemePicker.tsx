// Settings → Appearance: every palette as a small preview of the app; click one to use it.
import { Check } from "lucide-react";
import { t } from "@os/i18n";
import { CONTRAST_PAIRS, PALETTES, contrast, type Palette } from "./palettes";
import { choosePalette, usePalette } from "./theme";

function minContrast(p: Palette): number {
  return Math.min(...CONTRAST_PAIRS.map(([, fg, bg]) => contrast(p.colors[fg], p.colors[bg])));
}

function Preview({ p }: { p: Palette }) {
  const c = p.colors;
  return (
    <div className="theme-preview" style={{ background: c.bg, borderColor: c.line, color: c.text, fontFamily: p.fonts.sans }} aria-hidden>
      <div className="theme-preview-rail" style={{ background: c.bg2, borderColor: c.line }}>
        <span style={{ background: p.brand }} />
        <i style={{ background: c.accent }} />
        <i style={{ background: c.line2 }} />
      </div>
      <div className="theme-preview-body">
        <div style={{ background: c.panel, borderColor: c.line }}>
          <b style={{ color: c.text }}>refresh-tokens</b>
          <small style={{ color: c.text2 }}>12 ✓ · 1 ✗</small>
        </div>
        <div className="theme-preview-chips">
          <em style={{ background: c.accent, color: c.accentInk }}>OK</em>
          <em style={{ color: c.ok, borderColor: c.ok }}>ok</em>
          <em style={{ color: c.bad, borderColor: c.bad }}>!</em>
          <em style={{ color: c.info, borderColor: c.info }}>i</em>
        </div>
      </div>
    </div>
  );
}

export function ThemePicker() {
  const active = usePalette();
  return (
    <div className="theme-grid" role="radiogroup" aria-label={t("Palette")}>
      {PALETTES.map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={active.id === p.id}
          className={`theme-card${active.id === p.id ? " on" : ""}`}
          onClick={() => void choosePalette(p.id)}
        >
          <Preview p={p} />
          <span className="theme-name">
            {t(p.name)} {p.id === "nexo" && <span className="pill">{t("default")}</span>}
            {active.id === p.id && <Check size={15} />}
          </span>
          <span className="theme-desc">{t(p.description)}</span>
          <span className="faint num" style={{ fontSize: 11.5 }}>{t("lowest contrast {r}:1", { r: minContrast(p).toFixed(1) })}</span>
        </button>
      ))}
    </div>
  );
}
