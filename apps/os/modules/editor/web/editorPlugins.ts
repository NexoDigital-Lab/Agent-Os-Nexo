// agent-os's own take on a few VS Code extensions, turned on per project from the Extensiones page.
// Monaco providers are global, so `applyPlugins` registers them for the editor on screen and returns the undo.
import { emmetCSS, emmetHTML, emmetJSX } from "emmet-monaco-es";
import { monaco } from "./monaco";
import type { EditorPlugin } from "./api";

type Ed = monaco.editor.IStandaloneCodeEditor;
type Snip = [prefix: string, body: string, doc: string];

const JS_LANGS = ["javascript", "typescript"];

// ---------- snippets ----------
const SNIPPETS: Partial<Record<EditorPlugin, { langs: string[]; items: Snip[] }>> = {
  go: {
    langs: ["go"],
    items: [
      ["main", 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("${1:hola}")\n}', "package main + func main"],
      ["func", "func ${1:name}(${2:params}) ${3:error} {\n\t$0\n}", "function"],
      ["meth", "func (${1:r} *${2:Type}) ${3:Name}(${4}) ${5:error} {\n\t$0\n}", "method"],
      ["iferr", "if err != nil {\n\treturn ${1:err}\n}", "if err != nil"],
      ["forr", "for ${1:i}, ${2:v} := range ${3:items} {\n\t$0\n}", "for range"],
      ["for", "for ${1:i} := 0; $1 < ${2:n}; $1++ {\n\t$0\n}", "classic for"],
      ["st", "type ${1:Name} struct {\n\t${2:Field} ${3:string} `json:\"${4:field}\"`\n}", "struct"],
      ["inf", "type ${1:Name} interface {\n\t${2:Method}() ${3:error}\n}", "interface"],
      ["pf", 'fmt.Printf("${1:%v}\\n", ${2:v})', "fmt.Printf"],
      ["pl", "fmt.Println(${1})", "fmt.Println"],
      ["go", "go func() {\n\t$0\n}()", "goroutine"],
      ["sel", "select {\ncase ${1:v} := <-${2:ch}:\n\t$0\ndefault:\n}", "select"],
      ["test", "func Test${1:Name}(t *testing.T) {\n\t$0\n}", "test"],
      ["hf", "func ${1:handler}(w http.ResponseWriter, r *http.Request) {\n\t$0\n}", "http handler"],
      ["srv", 'http.HandleFunc("${1:/}", ${2:handler})\nlog.Fatal(http.ListenAndServe(":${3:8080}", nil))', "servidor http"],
    ],
  },
  js: {
    langs: JS_LANGS,
    items: [
      ["clg", "console.log(${1})", "console.log"],
      ["fn", "function ${1:name}(${2}) {\n\t$0\n}", "function"],
      ["afn", "const ${1:name} = (${2}) => {\n\t$0\n};", "arrow function"],
      ["asf", "async function ${1:name}(${2}) {\n\t$0\n}", "async function"],
      ["tc", "try {\n\t$0\n} catch (${1:err}) {\n\tconsole.error($1);\n}", "try/catch"],
      ["fetch", "const res = await fetch(${1:url});\nconst ${2:data} = await res.json();", "fetch + json"],
      ["qs", "document.querySelector(${1:'selector'})", "querySelector"],
      ["ael", "${1:el}.addEventListener('${2:click}', (${3:e}) => {\n\t$0\n});", "addEventListener"],
      ["imp", "import ${2:name} from '${1:module}';", "import"],
      ["map", "${1:arr}.map((${2:item}) => ${3:item})", "array map"],
    ],
  },
  react: {
    langs: JS_LANGS,
    items: [
      ["rafce", "const ${1:Component} = () => {\n\treturn (\n\t\t<div>$0</div>\n\t);\n};\n\nexport default $1;", "componente arrow + export default"],
      ["rfc", "export function ${1:Component}() {\n\treturn <div>$0</div>;\n}", "function component"],
      ["us", "const [${1:state}, set${2:State}] = useState(${3});", "useState"],
      ["ue", "useEffect(() => {\n\t$0\n}, [${1}]);", "useEffect"],
      ["ur", "const ${1:ref} = useRef(${2:null});", "useRef"],
      ["um", "const ${1:value} = useMemo(() => ${2}, [${3}]);", "useMemo"],
      ["uc", "const ${1:fn} = useCallback((${2}) => {\n\t$0\n}, [${3}]);", "useCallback"],
      ["imr", "import { ${1:useState} } from 'react';", "import from react"],
    ],
  },
  next: {
    langs: JS_LANGS,
    items: [
      ["npage", "export default function ${1:Page}() {\n\treturn <main>$0</main>;\n}", "app/…/page.tsx"],
      ["nlayout", "export default function ${1:Layout}({ children }: { children: React.ReactNode }) {\n\treturn <>{children}</>;\n}", "layout.tsx"],
      ["nroute", "import { NextResponse } from 'next/server';\n\nexport async function ${1:GET}(request: Request) {\n\treturn NextResponse.json({ ${2:ok: true} });\n}", "route handler"],
      ["naction", "'use server';\n\nexport async function ${1:action}(formData: FormData) {\n\t$0\n}", "server action"],
      ["nmeta", "export const metadata = {\n\ttitle: '${1:Title}',\n\tdescription: '${2}',\n};", "metadata"],
      ["uclient", "'use client';\n", "'use client'"],
    ],
  },
  nest: {
    langs: ["typescript"],
    items: [
      ["nctrl", "import { Controller, Get } from '@nestjs/common';\n\n@Controller('${1:path}')\nexport class ${2:Name}Controller {\n\tconstructor(private readonly ${3:service}: ${2}Service) {}\n\n\t@Get()\n\tfindAll() {\n\t\treturn this.$3.findAll();\n\t}\n}", "controller"],
      ["nservice", "import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class ${1:Name}Service {\n\t$0\n}", "service"],
      ["nmodule", "import { Module } from '@nestjs/common';\n\n@Module({\n\timports: [],\n\tcontrollers: [${1:Name}Controller],\n\tproviders: [$1Service],\n})\nexport class $1Module {}", "module"],
      ["ndto", "import { IsString } from 'class-validator';\n\nexport class ${1:Create}${2:Name}Dto {\n\t@IsString()\n\t${3:name}: string;\n}", "DTO with class-validator"],
      ["nget", "@Get('${1::id}')\n${2:findOne}(@Param('${3:id}') ${3}: string) {\n\t$0\n}", "@Get with @Param"],
      ["npost", "@Post()\n${1:create}(@Body() ${2:dto}: ${3:CreateDto}) {\n\t$0\n}", "@Post with @Body"],
    ],
  },
};

function registerSnippets(langs: string[], items: Snip[]): monaco.IDisposable[] {
  return langs.map((lang) =>
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(model, pos) {
        const w = model.getWordUntilPosition(pos);
        const range = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
        return {
          suggestions: items.map(([prefix, body, doc]) => ({
            label: prefix,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: doc,
            documentation: { value: "```\n" + body.replace(/\$\{\d+:?([^}]*)\}/g, "$1").replace(/\$\d/g, "") + "\n```" },
            insertText: body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      },
    }),
  );
}

// ---------- tailwind ----------
let twClasses: string[] | null = null;
function tailwindClasses(): string[] {
  if (twClasses) return twClasses;
  const scale = ["0", "0.5", "1", "1.5", "2", "2.5", "3", "4", "5", "6", "8", "10", "12", "16", "20", "24", "32", "40", "48", "64", "px"];
  const spacing = ["p", "px", "py", "pt", "pr", "pb", "pl", "m", "mx", "my", "mt", "mr", "mb", "ml", "gap", "gap-x", "gap-y", "space-x", "space-y", "inset", "top", "right", "bottom", "left"];
  const sizing = ["w", "h", "min-w", "min-h", "max-h", "size"];
  const colors = ["slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
  const shades = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
  const colorProps = ["text", "bg", "border", "ring", "from", "via", "to", "fill", "stroke", "outline", "divide", "placeholder"];
  const out = [
    ...spacing.flatMap((p) => scale.map((s) => `${p}-${s}`)),
    ...["m", "mx", "my", "mt", "mr", "mb", "ml"].map((p) => `${p}-auto`),
    ...sizing.flatMap((p) => [...scale, "auto", "full", "screen", "fit", "min", "max", "1/2", "1/3", "2/3", "1/4", "3/4"].map((s) => `${p}-${s}`)),
    ...["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "full", "prose", "screen-sm", "screen-md", "screen-lg", "screen-xl"].map((s) => `max-w-${s}`),
    ...colorProps.flatMap((p) => [...colors.flatMap((c) => shades.map((s) => `${p}-${c}-${s}`)), `${p}-white`, `${p}-black`, `${p}-transparent`, `${p}-current`]),
    ...["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"].map((s) => `text-${s}`),
    ...["thin", "light", "normal", "medium", "semibold", "bold", "extrabold"].map((s) => `font-${s}`),
    ...["none", "sm", "", "md", "lg", "xl", "2xl", "3xl", "full"].map((s) => (s ? `rounded-${s}` : "rounded")),
    ...["sm", "", "md", "lg", "xl", "2xl", "inner", "none"].map((s) => (s ? `shadow-${s}` : "shadow")),
    ...["0", "2", "4", "8"].map((s) => `border-${s}`),
    ...["1", "2", "3", "4", "5", "6", "12"].flatMap((n) => [`grid-cols-${n}`, `col-span-${n}`, `grid-rows-${n}`]),
    ...["0", "10", "20", "30", "40", "50"].map((n) => `z-${n}`),
    ...["0", "25", "50", "75", "100"].map((n) => `opacity-${n}`),
    ...["75", "100", "150", "200", "300", "500"].map((n) => `duration-${n}`),
    "flex", "inline-flex", "grid", "inline-grid", "block", "inline-block", "inline", "hidden", "contents",
    "flex-row", "flex-col", "flex-wrap", "flex-nowrap", "flex-1", "flex-auto", "flex-none", "grow", "shrink-0",
    "items-start", "items-center", "items-end", "items-stretch", "items-baseline",
    "justify-start", "justify-center", "justify-end", "justify-between", "justify-around", "justify-evenly",
    "self-auto", "self-start", "self-center", "self-end", "place-items-center", "content-center",
    "static", "relative", "absolute", "fixed", "sticky", "overflow-hidden", "overflow-auto", "overflow-x-auto", "overflow-y-auto",
    "text-left", "text-center", "text-right", "uppercase", "lowercase", "capitalize", "italic", "underline", "line-through", "no-underline",
    "truncate", "whitespace-nowrap", "break-words", "leading-none", "leading-tight", "leading-normal", "leading-relaxed", "tracking-tight", "tracking-wide",
    "border", "border-t", "border-b", "border-l", "border-r", "border-dashed", "ring", "ring-2", "outline-none",
    "cursor-pointer", "cursor-not-allowed", "select-none", "pointer-events-none", "transition", "transition-colors", "transition-all", "ease-in-out",
    "object-cover", "object-contain", "aspect-square", "aspect-video", "container", "mx-auto", "sr-only", "antialiased",
    "bg-gradient-to-r", "bg-gradient-to-b", "backdrop-blur", "backdrop-blur-sm", "blur", "animate-spin", "animate-pulse",
  ];
  twClasses = [...new Set(out)];
  return twClasses;
}

function registerTailwind(): monaco.IDisposable[] {
  return [...JS_LANGS, "html"].map((lang) =>
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['"', "'", "`", " ", ":", "-"],
      provideCompletionItems(model, pos) {
        const before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
        // Only inside class="…" / className="…" / className={`…`} / cn("…")-style calls.
        if (!/(class(Name)?\s*=\s*\{?\s*[`"']|(cn|clsx|cva|twMerge)\([^)]*["'`])[^"'`]*$/.test(before)) return { suggestions: [] };
        // The word after the last space/quote/variant colon, so "md:hover:bg-" keeps its variants.
        const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf('"'), before.lastIndexOf("'"), before.lastIndexOf("`"), before.lastIndexOf(":")) + 2;
        const range = new monaco.Range(pos.lineNumber, start, pos.lineNumber, pos.column);
        return {
          suggestions: tailwindClasses().map((c) => ({ label: c, kind: monaco.languages.CompletionItemKind.Value, detail: "tailwind", insertText: c, range })),
        };
      },
    }),
  );
}

// ---------- prettier ----------
const PARSER: Record<string, string> = { typescript: "typescript", javascript: "babel", json: "json", css: "css", scss: "scss", html: "html", markdown: "markdown", yaml: "yaml" };

async function prettierFormat(text: string, lang: string, filepath: string, tabSize: number, insertSpaces: boolean): Promise<string> {
  const prettier = await import("prettier/standalone");
  const load = {
    typescript: () => Promise.all([import("prettier/plugins/typescript"), import("prettier/plugins/estree")]),
    babel: () => Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree")]),
    json: () => Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree")]),
    css: () => Promise.all([import("prettier/plugins/postcss")]),
    scss: () => Promise.all([import("prettier/plugins/postcss")]),
    html: () => Promise.all([import("prettier/plugins/html"), import("prettier/plugins/postcss"), import("prettier/plugins/babel"), import("prettier/plugins/estree")]),
    markdown: () => Promise.all([import("prettier/plugins/markdown")]),
    yaml: () => Promise.all([import("prettier/plugins/yaml")]),
  }[PARSER[lang]]!;
  const plugins = (await load()).map((m: any) => m.default ?? m);
  return prettier.format(text, { parser: PARSER[lang], plugins, filepath, tabWidth: tabSize, useTabs: !insertSpaces, printWidth: 110 });
}

function registerPrettier(onError: (msg: string) => void): monaco.IDisposable[] {
  return Object.keys(PARSER).map((lang) =>
    monaco.languages.registerDocumentFormattingEditProvider(lang, {
      displayName: "Prettier",
      async provideDocumentFormattingEdits(model, opts) {
        try {
          const text = await prettierFormat(model.getValue(), lang, model.uri.path, opts.tabSize, opts.insertSpaces);
          return [{ range: model.getFullModelRange(), text }];
        } catch (e: any) {
          onError(`Prettier: ${String(e.message ?? e).split("\n")[0]}`);
          return [];
        }
      },
    }),
  );
}

// ---------- error lens ----------
function errorLens(ed: Ed): monaco.IDisposable {
  const deco = ed.createDecorationsCollection();
  const paint = () => {
    const model = ed.getModel();
    if (!model) return deco.clear();
    const worst = new Map<number, monaco.editor.IMarker>(); // one message per line, the most severe
    for (const m of monaco.editor.getModelMarkers({ resource: model.uri })) {
      if (m.severity < monaco.MarkerSeverity.Warning) continue;
      const cur = worst.get(m.startLineNumber);
      if (!cur || m.severity > cur.severity) worst.set(m.startLineNumber, m);
    }
    deco.set(
      [...worst.values()].map((m) => ({
        // `after` text renders at the range's end, so the range spans the whole line.
        range: new monaco.Range(m.startLineNumber, 1, m.startLineNumber, model.getLineMaxColumn(m.startLineNumber)),
        options: {
          isWholeLine: true,
          className: m.severity === monaco.MarkerSeverity.Error ? "lens-line-err" : "lens-line-warn",
          after: {
            content: `   ${m.message.split("\n")[0].slice(0, 160)}`,
            inlineClassName: m.severity === monaco.MarkerSeverity.Error ? "lens-err" : "lens-warn",
          },
        },
      })),
    );
  };
  const a = monaco.editor.onDidChangeMarkers(paint);
  const b = ed.onDidChangeModel(paint);
  paint();
  return { dispose: () => (a.dispose(), b.dispose(), deco.clear()) };
}

// ---------- entry ----------
export function applyPlugins(keys: EditorPlugin[], ed: Ed, onError: (msg: string) => void): () => void {
  const on = new Set(keys);
  const subs: monaco.IDisposable[] = [];
  const undo: (() => void)[] = [];

  ed.updateOptions({
    bracketPairColorization: { enabled: on.has("brackets") },
    guides: { bracketPairs: on.has("brackets") ? "active" : false, indentation: true },
  });
  if (on.has("errorlens")) subs.push(errorLens(ed));
  // "standard" = Monaco's public token API; the default Monarch path reads internals that changed in 0.56 and throws.
  const emmetOpts = { tokenizer: "standard" as const };
  if (on.has("emmet")) undo.push(emmetHTML(monaco, ["html"], emmetOpts), emmetCSS(monaco, ["css", "scss", "less"], emmetOpts), emmetJSX(monaco, JS_LANGS, emmetOpts));
  if (on.has("prettier")) subs.push(...registerPrettier(onError));
  if (on.has("tailwind")) subs.push(...registerTailwind());
  for (const k of on) {
    const pack = SNIPPETS[k];
    if (pack) subs.push(...registerSnippets(pack.langs, pack.items));
  }
  return () => {
    subs.forEach((s) => s.dispose());
    undo.forEach((u) => u());
  };
}

export const PLUGIN_LABEL: Record<EditorPlugin, string> = {
  icons: "Icons", prettier: "Prettier (Shift+Alt+F)", errorlens: "Error Lens", brackets: "Bracket colors", emmet: "Emmet",
  go: "Go snippets", react: "React snippets", next: "Next snippets", nest: "Nest snippets", js: "JS snippets", tailwind: "Tailwind classes",
};
