// The editor's top bar: open-file tabs, language-server and extension status, and the workspace actions.
import { Columns2, Command, Eye, PanelLeft, Puzzle, Save, Settings, SquareTerminal, Target, WandSparkles, X } from "lucide-react";
import { FileIcon } from "./icons";
import type { EditorPlugin, Tab } from "./api";
import type { OpenFile } from "./EditorArea";
import { PLUGIN_LABEL } from "./editorPlugins";
import { LspPill, type LspStatus } from "../submodules/lsp/web/useLsp";
import { RunMenu } from "./Panel";
import { t } from "@os/i18n";

type Toggle = { on: boolean; set: (v: boolean) => void };

export function EditorToolbar(p: {
  tab: Tab;
  open: OpenFile[];
  active: string | null;
  highlight: boolean; // the active tab is the one on screen (not a diff or image)
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  lang: string | null;
  lsp: LspStatus | null;
  onLspMissing: () => void;
  plugins: EditorPlugin[] | null;
  canSave: boolean;
  saving: boolean;
  autosave: boolean;
  onSave: () => void;
  mdPreview: Toggle | null; // null when the active file isn't Markdown
  split: Toggle & { disabled: boolean };
  onRun: (cmd: string) => void;
  /** Absent when the setup submodule is off. */
  onSetup?: () => void;
  /** Absent when the practice submodule is off. */
  coach?: Toggle;
  onPalette: () => void;
  onSettings: () => void;
  sidebar: Toggle;
  panel: Toggle & { errors: number };
}) {
  return (
    <div className="p-bar">
      <button className="btn sm ghost" title={p.sidebar.on ? "Ocultar barra (Ctrl+B)" : "Mostrar barra (Ctrl+B)"} onClick={() => p.sidebar.set(!p.sidebar.on)}><PanelLeft size={14} /></button>
      <div className="p-files">
        {p.open.map((o) => (
          <div key={o.path} className={`p-file ${p.active === o.path && p.highlight ? "on" : ""}`} onClick={() => p.onSelect(o.path)} title={o.path}>
            <FileIcon name={o.path.split("/").pop()!} />
            <span>{o.path.split("/").pop()}</span>
            {o.content !== o.saved && <span className="dirty">●</span>}
            <button aria-label={t("Close {file}", { file: o.path })} onClick={(e) => (e.stopPropagation(), p.onClose(o.path))}><X size={12} /></button>
          </div>
        ))}
      </div>
      {p.lang && p.lsp && <LspPill lang={p.lang} status={p.lsp} onMissing={p.onLspMissing} />}
      {p.plugins && (
        <span
          className="plugins-pill"
          title={p.plugins.length ? `${t("Extensions active in the editor:")}\n${p.plugins.map((k) => `· ${t(PLUGIN_LABEL[k])}`).join("\n")}\n\n${t("Managed in the Extensions view.")}` : t("No editor extensions for this project (Extensions view).")}
        >
          <Puzzle size={14} /> {p.plugins.length}
        </span>
      )}
      <button className="btn sm ghost" title={p.autosave ? t("Autosave is on") : t("Save (Ctrl+S)")} aria-label={t("Save (Ctrl+S)")} disabled={!p.canSave} onClick={p.onSave}>
        {p.saving ? <span className="spin" /> : <Save size={14} />}
      </button>
      {p.mdPreview && <button className={`btn sm ${p.mdPreview.on ? "primary" : "ghost"}`} title={t("Markdown preview")} aria-label={t("Markdown preview")} onClick={() => p.mdPreview!.set(!p.mdPreview!.on)}><Eye size={14} /></button>}
      <button className={`btn sm ${p.split.on ? "primary" : "ghost"}`} title={t("Split editor (Ctrl+\\)")} aria-label={t("Split editor (Ctrl+\\)")} disabled={p.split.disabled} onClick={() => p.split.set(!p.split.on)}><Columns2 size={14} /></button>
      <RunMenu tab={p.tab} onRun={p.onRun} />
      {p.onSetup && <button className="btn sm ghost" title={t("Set up the project: template, toolchains, dependencies, .env, extensions")} aria-label={t("Set up the project (assistant)")} onClick={p.onSetup}><WandSparkles size={14} /></button>}
      {p.coach && <button className={`btn sm ${p.coach.on ? "primary" : "ghost"}`} title={t("Practice panel")} aria-label={t("Practice panel")} onClick={() => p.coach!.set(!p.coach!.on)}><Target size={14} /></button>}
      <button className="btn sm ghost" title={t("Command palette (Ctrl+Shift+P)")} aria-label={t("Command palette (Ctrl+Shift+P)")} onClick={p.onPalette}><Command size={14} /></button>
      <button className="btn sm ghost" title={t("Editor settings")} aria-label={t("Editor settings")} onClick={p.onSettings}><Settings size={14} /></button>
      <button className={`btn sm ${p.panel.on ? "primary" : "ghost"}`} title={t("Terminals, problems and environment (Ctrl+`)")} onClick={() => p.panel.set(!p.panel.on)}>
        <SquareTerminal size={14} /> Panel{p.panel.errors > 0 && <span className="pill bad" style={{ marginLeft: 4 }}>{p.panel.errors}</span>}
      </button>
    </div>
  );
}
