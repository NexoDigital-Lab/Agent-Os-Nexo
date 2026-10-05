// Problems panel: file:line errors scraped from terminal output (Go, tsc, ESLint, Python tracebacks, generic
// compiler style). Paths come back repo-relative so they open in the editor.
export type Problem = { file: string; line: number; col: number; severity: "error" | "warning"; message: string; source: string };

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
const EXT = "(?:go|ts|tsx|js|jsx|mjs|cjs|py|rs|c|h|cpp|java|kt|vue|svelte)";

const RULES: { re: RegExp; map: (m: RegExpMatchArray) => Omit<Problem, "file"> & { file: string } }[] = [
  // tsc: src/a.ts(12,5): error TS2322: …
  { re: new RegExp(`^(\\S+\\.${EXT})\\((\\d+),(\\d+)\\): (error|warning) (.+)$`), map: (m) => ({ file: m[1], line: +m[2], col: +m[3], severity: m[4] as Problem["severity"], message: m[5], source: "tsc" }) },
  // tsc --pretty / vite: src/a.ts:12:5 - error TS2322: …
  { re: new RegExp(`^(\\S+\\.${EXT}):(\\d+):(\\d+) - (error|warning) (.+)$`), map: (m) => ({ file: m[1], line: +m[2], col: +m[3], severity: m[4] as Problem["severity"], message: m[5], source: "tsc" }) },
  // go / gcc / rustc-short / generic: ./main.go:12:5: msg   ·   main.go:12: msg
  { re: new RegExp(`^(?:#\\s.*\\n)?(\\S+\\.${EXT}):(\\d+)(?::(\\d+))?:\\s*(?:(error|warning):\\s*)?(.+)$`), map: (m) => ({ file: m[1], line: +m[2], col: +(m[3] ?? 1), severity: (m[4] as Problem["severity"]) ?? "error", message: m[5], source: m[1].endsWith(".go") ? "go" : "build" }) },
  // Python traceback frame: File "app/x.py", line 12, in f
  { re: /^\s*File "(.+?\.py)", line (\d+)/, map: (m) => ({ file: m[1], line: +m[2], col: 1, severity: "error", message: "a Python traceback goes through here", source: "python" }) },
];

/** Stateful per terminal: ESLint's stylish format puts the file on its own line and the issues under it. */
export class ProblemParser {
  private partial = "";
  private eslintFile: string | null = null;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  reset() {
    this.partial = "";
    this.eslintFile = null;
  }

  /** Feed raw terminal output; returns problems found in the complete lines. */
  feed(chunk: string): Problem[] {
    const text = (this.partial + chunk.replace(ANSI, "")).replace(/\r(?!\n)/g, "\n");
    const lines = text.split(/\r?\n/);
    this.partial = lines.pop() ?? "";
    const out: Problem[] = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line) continue;
      const lint = line.match(/^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?$/);
      if (lint && this.eslintFile) {
        out.push({ file: this.rel(this.eslintFile), line: +lint[1], col: +lint[2], severity: lint[3] as Problem["severity"], message: lint[5] ? `${lint[4]} (${lint[5]})` : lint[4], source: "eslint" });
        continue;
      }
      if (new RegExp(`^(/|\\./)?\\S+\\.${EXT}$`).test(line)) {
        this.eslintFile = line;
        continue;
      }
      this.eslintFile = null;
      for (const r of RULES) {
        const m = line.match(r.re);
        if (m) {
          const p = r.map(m);
          out.push({ ...p, file: this.rel(p.file), message: p.message.trim().slice(0, 400) });
          break;
        }
      }
    }
    return out;
  }

  private rel(f: string) {
    let p = f.replace(/^\.\//, "");
    if (p.startsWith(this.cwd + "/")) p = p.slice(this.cwd.length + 1);
    return p;
  }
}
