// Monaco bundled locally (no CDN) with its language workers, plus a theme taken from the active palette.
import * as monaco from "monaco-editor";
import { currentPalette, monacoTheme, onPaletteChange } from "../../themes/web/theme";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "typescript" || label === "javascript") return new TsWorker();
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    return new EditorWorker();
  },
};

// The editor's theme follows the palette the user picked (themes module), live.
const applyTheme = (p = currentPalette()) => {
  monaco.editor.defineTheme("agent-os-nexo", monacoTheme(p));
  monaco.editor.setTheme("agent-os-nexo");
};
applyTheme();
onPaletteChange(applyTheme);

// The editor sees one file at a time, without the repo's node_modules or tsconfig: set JSX + modern modules, and
// hide the errors that only mean "can't see the rest of the project" (otherwise every import lights up red).
const ts = monaco.typescript;
for (const d of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  d.setCompilerOptions({
    ...d.getCompilerOptions(),
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    experimentalDecorators: true, // Nest
  });
  // 2307/2792 can't find module · 7016 no types for module · 2875 JSX runtime module missing · 1259/1192 default-import interop
  d.setDiagnosticsOptions({ ...d.getDiagnosticsOptions(), diagnosticCodesToIgnore: [2307, 2792, 7016, 2875, 1259, 1192] });
}

loader.config({ monaco });

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", css: "css", scss: "scss", html: "html", md: "markdown", py: "python", sh: "shell", yml: "yaml",
  yaml: "yaml", sql: "sql", go: "go", rs: "rust", java: "java", kt: "kotlin", xml: "xml", env: "ini", toml: "ini",
  prisma: "graphql", dockerfile: "dockerfile",
};

export function languageOf(file: string): string {
  const base = file.split("/").pop()!.toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base.startsWith(".env")) return "ini";
  return EXT[base.split(".").pop() ?? ""] ?? "plaintext";
}

/** The Monaco model of a repo file (models are keyed by file:///<repo-relative path>). */
export const modelOf = (path: string) => monaco.editor.getModel(monaco.Uri.parse(`file:///${path}`));

export { monaco };
