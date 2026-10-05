// A cheap code map: the top-level symbols (functions, classes, types, exported constants) of a repository with
// their line, grouped by file and split into parts (one per workspace or main source folder). Agents read the part
// they need instead of exploring the tree cold. Pure Node and regular expressions: no ctags, no LLM.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

export interface FileSymbols {
  file: string;
  symbols: Array<{ line: number; kind: string; name: string }>;
}

type Rule = [RegExp, string];

const JS: Rule[] = [
  [/^\s*export\s+(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, "function"],
  [/^(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, "function"],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
  [/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
  [/^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, "type"],
  [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
  [/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, "const"],
];
const RULES: Record<string, Rule[]> = {
  ".ts": JS, ".tsx": JS, ".js": JS, ".jsx": JS, ".mjs": JS, ".cjs": JS, ".vue": JS, ".svelte": JS,
  ".py": [[/^class\s+(\w+)/, "class"], [/^(?:async\s+)?def\s+(\w+)/, "function"], [/^\s+(?:async\s+)?def\s+(\w+)/, "method"]],
  ".go": [[/^func\s+\([^)]*\)\s*(\w+)/, "method"], [/^func\s+(\w+)/, "function"], [/^type\s+(\w+)\s+(?:struct|interface)\b/, "type"]],
  ".rs": [
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/, "function"],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union)\s+(\w+)/, "type"],
    [/^\s*impl(?:<[^>]*>)?\s+(?:\w+\s+for\s+)?(\w+)/, "impl"],
  ],
  ".java": [[/^\s*(?:public|protected|private|abstract|final|static|\s)*(?:class|interface|enum|record)\s+(\w+)/, "class"]],
  ".kt": [[/^\s*(?:\w+\s+)*(?:class|interface|object)\s+(\w+)/, "class"], [/^\s*(?:\w+\s+)*fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?(\w+)/, "function"]],
  ".cs": [[/^\s*(?:public|internal|protected|private|abstract|sealed|static|partial|\s)*(?:class|interface|enum|record|struct)\s+(\w+)/, "class"]],
  ".rb": [[/^\s*(?:class|module)\s+([\w:]+)/, "class"], [/^\s*def\s+(?:self\.)?(\w+[?!]?)/, "method"]],
  ".php": [[/^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+(\w+)/, "class"], [/^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+(\w+)/, "function"]],
  ".swift": [[/^\s*(?:\w+\s+)*(?:class|struct|enum|protocol|extension)\s+(\w+)/, "type"], [/^\s*(?:\w+\s+)*func\s+(\w+)/, "function"]],
  ".dart": [[/^\s*(?:abstract\s+)?class\s+(\w+)/, "class"]],
};

/** Folders that are never the project's own source. */
const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "target", "vendor", "__pycache__", ".venv", "venv", "env", "coverage", ".turbo", ".expo", ".gradle", "Pods", ".dart_tool", "bin", "obj"]);
const MAX_FILE = 512 * 1024;

export const mappable = (file: string) => extname(file) in RULES && !/\.min\.[cm]?js$/.test(file) && !/\.d\.ts$/.test(file);

export function symbolsOf(text: string, ext: string): FileSymbols["symbols"] {
  const rules = RULES[ext];
  if (!rules) return [];
  const out: FileSymbols["symbols"] = [];
  text.split("\n").forEach((line, i) => {
    for (const [re, kind] of rules) {
      const m = re.exec(line);
      if (m?.[1]) {
        out.push({ line: i + 1, kind, name: m[1] });
        break;
      }
    }
  });
  return out;
}

/** Every mappable file under `dir` with its symbols (files without any are left out). */
export function mapFolder(repo: string, dir: string): FileSymbols[] {
  const out: FileSymbols[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.size <= MAX_FILE && mappable(name)) {
        const symbols = symbolsOf(readFileSync(p, "utf8"), extname(name));
        if (symbols.length) out.push({ file: relative(repo, p).split("\\").join("/"), symbols });
      }
    }
  };
  walk(dir);
  return out;
}

const SOURCE_DIRS = ["apps", "packages", "services", "backend", "frontend", "server", "client", "api", "web", "app", "src", "lib", "modules", "core", "cmd", "internal", "mobile"];

/**
 * How the map is split: npm/pnpm/yarn workspaces first (one part per workspace folder), else the main source
 * folders when there are two or more, else the whole repository as one part.
 */
export function mapParts(repo: string): Array<{ name: string; dir: string }> {
  const parts: Array<{ name: string; dir: string }> = [];
  const seen = new Set<string>();
  const add = (dir: string) => {
    const rel = relative(repo, dir).split("\\").join("/");
    if (!rel || seen.has(rel)) return;
    seen.add(rel);
    parts.push({ name: rel.replace(/\//g, "-"), dir });
  };
  let globs: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { workspaces?: string[] | { packages?: string[] } };
    globs = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
  } catch {
    // no package.json, or not JSON: no npm workspaces
  }
  try {
    const pnpm = readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8");
    globs.push(...[...pnpm.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1]!));
  } catch {
    // no pnpm workspaces
  }
  for (const g of globs) {
    if (g.endsWith("/*")) {
      const base = join(repo, g.slice(0, -2));
      try {
        for (const name of readdirSync(base).sort()) if (statSync(join(base, name)).isDirectory()) add(join(base, name));
      } catch {
        // a glob that matches nothing
      }
    } else if (!/[*?]/.test(g)) add(join(repo, g));
  }
  if (parts.length) return parts;
  for (const name of SOURCE_DIRS) {
    try {
      if (statSync(join(repo, name)).isDirectory()) add(join(repo, name));
    } catch {
      // not there
    }
  }
  return parts.length >= 2 ? parts : [{ name: "code", dir: repo }];
}

export function renderMap(part: string, files: FileSymbols[], date: string): string {
  const lines = [`# code map · ${part} · ${date} · regenerate with \`nexo map\` when it goes stale`, ""];
  for (const f of files) {
    lines.push(f.file);
    for (const s of f.symbols) lines.push(`  ${String(s.line).padStart(5)} ${s.kind} ${s.name}`);
  }
  return `${lines.join("\n")}\n`;
}
