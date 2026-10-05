// The command palette's entries (Ctrl+Shift+P). The workspace passes its actions; this is just the list.
// Entries for submodules that are off (setup, practice) are left out.
import type { Command } from "./Palette";
import type { Settings } from "./settings";
import { t } from "@os/i18n";

type CommandActions = {
  setup?: () => void;
  save: () => void;
  saveAll: () => void;
  format: () => void;
  newEntry: (kind: "file" | "dir") => void;
  search: () => void;
  sourceControl: () => void;
  togglePanel: () => void;
  newTerminal: () => void;
  problems: () => void;
  environment: () => void;
  toggleSplit: () => void;
  toggleSidebar: () => void;
  toggleCoach?: () => void;
  toggleMarkdown: () => void;
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  closeAll: () => void;
  openInVscode: () => void;
  openSettings: () => void;
};

export const buildCommands = (a: CommandActions): Command[] => [
  ...(a.setup ? [{ id: "setup", label: t("Set up the project (assistant)"), run: a.setup }] : []),
  { id: "save", label: t("Save"), key: "Ctrl+S", run: a.save },
  { id: "saveall", label: t("Save all"), run: a.saveAll },
  { id: "format", label: t("Format document"), key: "Shift+Alt+F", run: a.format },
  { id: "newfile", label: t("New file"), run: () => a.newEntry("file") },
  { id: "newdir", label: t("New folder"), run: () => a.newEntry("dir") },
  { id: "search", label: t("Search the project"), key: "Ctrl+Shift+F", run: a.search },
  { id: "scm", label: t("Source control: view changes"), run: a.sourceControl },
  { id: "term", label: t("Terminal: show/hide the panel"), key: "Ctrl+`", run: a.togglePanel },
  { id: "newterm", label: t("Terminal: new terminal"), run: a.newTerminal },
  { id: "problems", label: t("View problems"), run: a.problems },
  { id: "env", label: t("Environment: installed toolchains"), run: a.environment },
  { id: "split", label: t("Split editor"), key: "Ctrl+\\", run: a.toggleSplit },
  { id: "sidebar", label: t("Sidebar: show/hide"), key: "Ctrl+B", run: a.toggleSidebar },
  ...(a.toggleCoach ? [{ id: "coach", label: t("Practice: show/hide the panel"), run: a.toggleCoach }] : []),
  { id: "md", label: t("Markdown: preview"), run: a.toggleMarkdown },
  { id: "autosave", label: a.settings.autosave ? t("Autosave: turn off") : t("Autosave: turn on"), run: () => a.setSettings({ autosave: !a.settings.autosave }) },
  { id: "wrap", label: a.settings.wordWrap ? t("Word wrap: turn off") : t("Word wrap: turn on"), run: () => a.setSettings({ wordWrap: !a.settings.wordWrap }) },
  { id: "minimap", label: a.settings.minimap ? t("Minimap: hide") : t("Minimap: show"), run: () => a.setSettings({ minimap: !a.settings.minimap }) },
  { id: "closeall", label: t("Close all editors"), run: a.closeAll },
  { id: "vscode", label: t("Open in VS Code"), run: a.openInVscode },
  { id: "settings", label: t("Editor settings"), run: a.openSettings },
];
