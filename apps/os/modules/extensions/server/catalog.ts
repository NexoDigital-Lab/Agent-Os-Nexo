// The extension catalog: VS Code extensions (IDs verified on the Marketplace) and, where one exists, the
// equivalent plugin agent-os's own editor implements (the editor module's editorPlugins.ts).
import { isEditorOnly, VSCODE_ID } from "../../projects/server/vscode.ts";
export { isEditorOnly, VSCODE_ID };

/** Keys of the plugins the editor module implements. */
export type EditorPlugin = "icons" | "prettier" | "errorlens" | "brackets" | "emmet" | "go" | "react" | "next" | "nest" | "js" | "tailwind";

export type Ext = {
  id: string; // VS Code id (publisher.name); "agent-os.*" = only exists in agent-os's editor
  name: string;
  desc: string;
  stacks?: string[]; // detected stacks that recommend it
  editor?: EditorPlugin;
};

export const CATALOG: Ext[] = [
  // Useful in any project
  { id: "pkief.material-icon-theme", name: "Material Icon Theme", desc: "Icons per file type and folder.", editor: "icons" },
  { id: "esbenp.prettier-vscode", name: "Prettier", desc: "Formats the code (Shift+Alt+F).", editor: "prettier" },
  { id: "usernamehw.errorlens", name: "Error Lens", desc: "Shows errors and warnings at the end of the line.", editor: "errorlens" },
  { id: "agent-os.brackets", name: "Bracket colors", desc: "Each pair of braces/parentheses with its own color and guides. VS Code has it built in.", editor: "brackets" },
  { id: "agent-os.emmet", name: "Emmet", desc: "HTML/CSS/JSX abbreviations (div.card>ul>li*3 + Tab). VS Code has it built in.", editor: "emmet" },
  { id: "eamodio.gitlens", name: "GitLens", desc: "Per-line blame, history and branch comparison." },
  { id: "christian-kohler.path-intellisense", name: "Path Intellisense", desc: "Completes file paths in imports." },
  // Per stack
  { id: "golang.go", name: "Go", desc: "Official Go support: gopls, tests, debugging. In agent-os: Go snippets.", stacks: ["go"], editor: "go" },
  { id: "xabikos.JavaScriptSnippets", name: "JavaScript (ES6) snippets", desc: "Modern JS snippets. In agent-os: clg, fn, afn, fetch…", stacks: ["javascript", "static"], editor: "js" },
  { id: "ritwickdey.LiveServer", name: "Live Server", desc: "Serves static HTML with live reload.", stacks: ["static"] },
  { id: "yoavbls.pretty-ts-errors", name: "Pretty TypeScript Errors", desc: "Readable TypeScript errors.", stacks: ["typescript"] },
  { id: "dbaeumer.vscode-eslint", name: "ESLint", desc: "JS/TS linting in the editor.", stacks: ["eslint"] },
  { id: "dsznajder.es7-react-js-snippets", name: "ES7+ React snippets", desc: "rafce, useState, useEffect… In agent-os: the main ones.", stacks: ["react", "next", "react-native"], editor: "react" },
  { id: "agent-os.next", name: "Next.js snippets", desc: "page, layout, route handler, server action, metadata.", stacks: ["next"], editor: "next" },
  { id: "bradlc.vscode-tailwindcss", name: "Tailwind CSS IntelliSense", desc: "Completes Tailwind classes. In agent-os: classes inside className/class.", stacks: ["tailwind"], editor: "tailwind" },
  { id: "ashinzekene.nestjs", name: "NestJS snippets", desc: "Controller, service, module, DTO. In agent-os: the main ones.", stacks: ["nest"], editor: "nest" },
  { id: "Prisma.prisma", name: "Prisma", desc: "Highlighting and formatting for schema.prisma.", stacks: ["prisma"] },
  { id: "humao.rest-client", name: "REST Client", desc: "Try endpoints from .http files.", stacks: ["api"] },
  { id: "mongodb.mongodb-vscode", name: "MongoDB", desc: "Browse the database and run queries.", stacks: ["mongodb"] },
  { id: "ms-python.python", name: "Python", desc: "Python support: environments, debugging, tests.", stacks: ["python"] },
  { id: "ms-python.vscode-pylance", name: "Pylance", desc: "Types and completion for Python.", stacks: ["python"] },
  { id: "charliermarsh.ruff", name: "Ruff", desc: "Fast linting and formatting for Python.", stacks: ["python"] },
  { id: "batisteo.vscode-django", name: "Django", desc: "Django templates and snippets.", stacks: ["django"] },
  { id: "ms-azuretools.vscode-docker", name: "Docker", desc: "Dockerfile, compose and containers.", stacks: ["docker"] },
  { id: "redhat.vscode-yaml", name: "YAML", desc: "YAML validation (compose, CI).", stacks: ["yaml"] },
  { id: "mikestead.dotenv", name: "DotENV", desc: "Highlighting for .env files.", stacks: ["dotenv"] },
  { id: "msjsdiag.vscode-react-native", name: "React Native Tools", desc: "React Native debugging and commands.", stacks: ["react-native"] },
  { id: "expo.vscode-expo-tools", name: "Expo Tools", desc: "Completion for app.json / eas.json.", stacks: ["expo"] },
  { id: "astro-build.astro-vscode", name: "Astro", desc: "Support for .astro files.", stacks: ["astro"] },
  { id: "Vue.volar", name: "Vue (Official)", desc: "Vue 3 support.", stacks: ["vue"] },
];
export const byId = new Map(CATALOG.map((e) => [e.id.toLowerCase(), e]));
