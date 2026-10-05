// Editor settings (per browser): font, tab size, wrap, minimap, autosave — and the ⚙ popover that edits them.
import { useState } from "react";
import { readLS, writeLS } from "@os/lib/storage";
import { t } from "@os/i18n";

export type Settings = { fontSize: number; tabSize: number; wordWrap: boolean; minimap: boolean; autosave: boolean };
const DEFAULT_SETTINGS: Settings = { fontSize: 13.5, tabSize: 2, wordWrap: false, minimap: false, autosave: false };

export function useEditorSettings() {
  const [settings, setAll] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...readLS<Partial<Settings>>("editorSettings", {}) }));
  const set = (p: Partial<Settings>) =>
    setAll((s) => {
      const next = { ...s, ...p };
      writeLS("editorSettings", next);
      return next;
    });
  return [settings, set] as const;
}

/** Monaco options derived from the settings. */
export const monacoOptions = (s: Settings) => ({
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: s.fontSize,
  tabSize: s.tabSize,
  wordWrap: s.wordWrap ? ("on" as const) : ("off" as const),
  minimap: { enabled: s.minimap },
  glyphMargin: true,
  smoothScrolling: true,
  scrollBeyondLastLine: false,
  padding: { top: 12 },
  renderLineHighlight: "all" as const,
});

export function SettingsBox({ settings, set, onClose }: { settings: Settings; set: (p: Partial<Settings>) => void; onClose: () => void }) {
  const tog = (k: "wordWrap" | "minimap" | "autosave", label: string) => (
    <label><input type="checkbox" checked={settings[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <div className="settings-box">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>{t("Editor settings")}</b>
        <button className="linkish" onClick={onClose}>{t("close")}</button>
      </div>
      <label>{t("Font size")} <input type="number" className="field" min={10} max={24} step={0.5} value={settings.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) || 13.5 })} /></label>
      <label>{t("Tab size")} <select className="field" value={settings.tabSize} onChange={(e) => set({ tabSize: Number(e.target.value) })}>{[2, 4, 8].map((n) => <option key={n}>{n}</option>)}</select></label>
      {tog("autosave", t("Autosave (1 s after you stop typing)"))}
      {tog("wordWrap", t("Word wrap"))}
      {tog("minimap", "Minimapa")}
      <div className="faint" style={{ fontSize: 11 }}>{t("Shortcuts: Ctrl+P file · Ctrl+Shift+P commands · Ctrl+Shift+F search · Ctrl+B sidebar · Ctrl+\\ split · Ctrl+` panel · Ctrl+G line · F12 definition")}</div>
    </div>
  );
}
