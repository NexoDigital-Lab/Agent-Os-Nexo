// One short line and an icon per known module, for the cards. A module not listed here (one the user wrote)
// shows its manifest description and a generic icon.
import {
  Activity, ArrowLeftRight, BookA, BookOpen, Blocks, Box, Braces, Bug, Code, Container, FileText, FolderGit2, GitBranch,
  GraduationCap, History, House, KeyRound, MessagesSquare, Network, Palette, PanelLeft, ShieldCheck, Puzzle, SquareTerminal, Wrench,
  type LucideIcon,
} from "lucide-react";

export const SUMMARIES: Record<string, string> = {
  architecture: "Each project's architecture, followed by its agents",
  dictionary: "Your concepts, so no agent asks twice",
  docker: "Containers, images and a dev container per project",
  docs: "agent-os-nexo's documentation, searchable",
  editor: "A full code editor inside each tab",
  "editor/lsp": "Completion and diagnostics for Go and Python",
  "editor/practice": "The AI guides you step by step; you write the code",
  "editor/scm": "Git in the editor: changes, commits and branches",
  "editor/setup": "Prepares a project: toolchains, dependencies, .env",
  "editor/terminal": "Terminals per tab that survive a reload",
  extensions: "VS Code extensions per project, with recommendations",
  home: "Start page: projects, recent sessions and today",
  http: "HTTP client with collections and curl/Postman import",
  modules: "Turns modules on and off",
  monitor: "Tokens and cost of every AI session",
  notes: "Notes per project that an AI turns into features",
  permissions: "What agents may do on their own",
  projects: "Create, clone and manage projects",
  sessions: "AI chat tabs, with agents and change review",
  shell: "The app frame: rail, views and settings",
  ssh: "SSH accesses in an encrypted vault",
  themes: "Color palettes and fonts",
  versions: "Your builds of agent-os-nexo",
  "visual-bugs": "Screenshots of what looks wrong, for an agent to fix",
};

const ICONS: Record<string, LucideIcon> = {
  architecture: Network, dictionary: BookA, docker: Container, docs: BookOpen, editor: Code, "editor/lsp": Braces,
  "editor/practice": GraduationCap, "editor/scm": GitBranch, "editor/setup": Wrench, "editor/terminal": SquareTerminal,
  extensions: Puzzle, home: House, http: ArrowLeftRight, modules: Blocks, monitor: Activity, notes: FileText,
  permissions: ShieldCheck, projects: FolderGit2, sessions: MessagesSquare, shell: PanelLeft, ssh: KeyRound, themes: Palette, versions: History,
  "visual-bugs": Bug,
};

export const iconFor = (id: string): LucideIcon => ICONS[id] ?? Box;
