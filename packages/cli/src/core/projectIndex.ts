// The project index agents read instead of exploring a repository cold: an overview (stack, parts, entry points,
// services, API, how the parts talk), the folder tree, every HTTP route, and the symbols by file. Deterministic and
// dependency-free (regular expressions, a tiny compose reader); written by `nexo map` into context/map/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { mapParts, mappable, renderMap, symbolsOf, type FileSymbols } from "./symbols.ts";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "target", "vendor", "__pycache__", ".venv", "venv", "env", "coverage", ".turbo", ".expo", ".gradle", "Pods", ".dart_tool", "bin", "obj", ".cache", ".idea", ".vscode"]);
const MAX_FILE = 512 * 1024;
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".go", ".rs", ".java", ".kt", ".cs", ".rb", ".php", ".swift", ".dart"]);

export interface Route { method: string; path: string; file: string; line: number; part: string }
export interface Call { path: string; method: string; file: string; line: number; part: string }
export interface Service { name: string; image?: string; build?: string; ports: string[]; dependsOn: string[]; env: string[] }
export interface Part { name: string; dir: string; manifest: string | null; packageName: string | null; frameworks: string[]; entries: string[] }

interface SourceFile { rel: string; part: string; ext: string; text: string }

const posix = (p: string) => p.split("\\").join("/");
/** Tests and end-to-end suites: their routes and calls are not how the parts of the product talk. */
export const isTest = (rel: string) => /(?:^|\/)(?:tests?|__tests__|e2e|spec|cypress|playwright)\/|\.(?:spec|test)\.[cm]?[jt]sx?$|(?:^|\/)conftest\.py$|_test\.(?:go|py)$|(?:^|\/)test_[^/]*\.py$/.test(rel);

/** Every file of the repository (dependencies and builds left out), with the text of the code files. */
function walk(repo: string, parts: Part[]): { files: string[]; sources: SourceFile[] } {
  const files: string[] = [];
  const sources: SourceFile[] = [];
  const partOf = (rel: string) => parts.find((p) => p.dir && (rel === p.dir || rel.startsWith(`${p.dir}/`)))?.name ?? parts.find((p) => !p.dir)?.name ?? "code";
  const go = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP.has(name) || (name.startsWith(".") && name !== ".env.example" && name !== ".github")) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      const rel = posix(relative(repo, abs));
      if (st.isDirectory()) go(abs);
      else {
        files.push(rel);
        const ext = extname(name);
        if (CODE_EXT.has(ext) && st.size <= MAX_FILE && !/\.min\.[cm]?js$/.test(name)) {
          sources.push({ rel, part: partOf(rel), ext, text: readFileSync(abs, "utf8") });
        }
      }
    }
  };
  go(repo);
  return { files, sources };
}

const read = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

const FRAMEWORKS: Array<[RegExp, string]> = [
  [/^next$/, "Next.js"], [/^react$/, "React"], [/^vue$/, "Vue"], [/^svelte$/, "Svelte"], [/^@angular\/core$/, "Angular"],
  [/^react-native$/, "React Native"], [/^expo$/, "Expo"], [/^@capacitor\/core$/, "Capacitor"], [/^electron$/, "Electron"],
  [/^@tauri-apps\/api$/, "Tauri"], [/^express$/, "Express"], [/^fastify$/, "Fastify"], [/^@nestjs\/core$/, "NestJS"],
  [/^hono$/, "Hono"], [/^koa$/, "Koa"], [/^@prisma\/client$|^prisma$/, "Prisma"], [/^typeorm$/, "TypeORM"],
  [/^drizzle-orm$/, "Drizzle"], [/^mongoose$/, "Mongoose"], [/^vite$/, "Vite"], [/^tailwindcss$/, "Tailwind"],
  [/^socket\.io$/, "Socket.IO"], [/^graphql$/, "GraphQL"], [/^@trpc\/server$/, "tRPC"], [/^stripe$/, "Stripe"],
  [/^fastapi$/i, "FastAPI"], [/^django$/i, "Django"], [/^flask$/i, "Flask"], [/^sqlalchemy$/i, "SQLAlchemy"],
  [/^celery$/i, "Celery"], [/^alembic$/i, "Alembic"], [/^pydantic$/i, "Pydantic"],
  [/gin-gonic\/gin$/, "Gin"], [/labstack\/echo/, "Echo"], [/gofiber\/fiber/, "Fiber"], [/gorm\.io\/gorm/, "GORM"],
  [/^axum$/, "Axum"], [/^actix-web$/, "Actix"], [/^tokio$/, "Tokio"], [/^tauri$/, "Tauri"], [/^rocket$/, "Rocket"],
];

/** Dependency names declared by the manifests in a folder (package.json, pyproject/requirements, go.mod, Cargo.toml). */
function dependenciesIn(dir: string): { manifest: string | null; deps: string[]; packageName: string | null; scripts: Record<string, string>; main: string | null } {
  const pkg = read(join(dir, "package.json"));
  if (pkg) {
    try {
      const j = JSON.parse(pkg) as { name?: string; dependencies?: object; devDependencies?: object; scripts?: Record<string, string>; main?: string; bin?: string | Record<string, string> };
      const bin = typeof j.bin === "string" ? j.bin : j.bin ? Object.values(j.bin)[0] ?? null : null;
      return { manifest: "package.json", deps: [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})], packageName: j.name ?? null, scripts: j.scripts ?? {}, main: j.main ?? bin };
    } catch {
      // a broken package.json: fall through to the other manifests
    }
  }
  const py = read(join(dir, "pyproject.toml")) + "\n" + read(join(dir, "requirements.txt"));
  if (py.trim()) {
    const deps = [...py.matchAll(/^\s*["']?([A-Za-z][\w.-]*)(?:\[[^\]]*\])?\s*(?:[=<>~!]=?|["',]|$)/gm)].map((m) => m[1]!.toLowerCase());
    return { manifest: existsSync(join(dir, "pyproject.toml")) ? "pyproject.toml" : "requirements.txt", deps, packageName: null, scripts: {}, main: null };
  }
  const gomod = read(join(dir, "go.mod"));
  if (gomod) {
    const deps = [...gomod.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[\w./-]+)\s+v/gm)].map((m) => m[1]!);
    return { manifest: "go.mod", deps, packageName: /^module\s+(\S+)/m.exec(gomod)?.[1] ?? null, scripts: {}, main: null };
  }
  const cargo = read(join(dir, "Cargo.toml"));
  if (cargo) {
    const deps = [...cargo.split(/^\[/m).filter((s) => /^(?:dev-)?dependencies\]/.test(s)).join("\n").matchAll(/^([\w-]+)\s*=/gm)].map((m) => m[1]!);
    return { manifest: "Cargo.toml", deps, packageName: /^name\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? null, scripts: {}, main: null };
  }
  return { manifest: null, deps: [], packageName: null, scripts: {}, main: null };
}

const ENTRY_FILES = /(?:^|\/)(?:main\.(?:go|py|ts|tsx|js|rs)|index\.(?:ts|js)|server\.(?:ts|js)|app\.(?:py|ts|js)|manage\.py|wsgi\.py|asgi\.py|lib\.rs|App\.(?:tsx|jsx|vue))$/;

function describeParts(repo: string, files: string[]): Part[] {
  return mapParts(repo).map((p) => {
    const dir = posix(relative(repo, p.dir));
    const info = dependenciesIn(p.dir);
    const frameworks = [...new Set(info.deps.flatMap((d) => FRAMEWORKS.filter(([re]) => re.test(d)).map(([, n]) => n)))];
    const prefix = dir ? `${dir}/` : "";
    const entries = [
      ...Object.entries(info.scripts).filter(([k]) => /^(dev|start|serve|build)$/.test(k)).map(([k, v]) => `npm run ${k} → ${v}`),
      ...(info.main ? [`main: ${info.main}`] : []),
      ...files.filter((f) => f.startsWith(prefix) && ENTRY_FILES.test(f) && f.slice(prefix.length).split("/").length <= 3).slice(0, 6),
    ];
    return { name: p.name, dir, manifest: info.manifest, packageName: info.packageName, frameworks, entries };
  });
}

// ── HTTP: the routes each part serves, and the calls each part makes ─────────────────────────────────────────

const ROUTE_RES: Array<[RegExp, (m: RegExpExecArray) => [string, string]]> = [
  // Express, Fastify, Hono, Koa routers and Go routers (gin/echo/chi) with a literal path.
  [/\b(?:app|router|api|server|routes?|r|e|g|v\d|group|mux)\.(get|post|put|patch|delete|options|all|GET|POST|PUT|PATCH|DELETE)\(\s*['"`](\/[^'"`]*)['"`]/, (m) => [m[1]!.toUpperCase(), m[2]!]],
  // FastAPI / Flask decorators.
  [/^\s*@\w+\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/, (m) => [m[1] === "route" ? "ANY" : m[1]!.toUpperCase(), m[2]!]],
  // net/http.
  [/\bhttp\.(?:HandleFunc|Handle)\(\s*"([^"]+)"/, (m) => ["ANY", m[1]!]],
  // Django urls.py.
  [/\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,/, (m) => ["ANY", `/${m[1]!.replace(/^\^|\$$/g, "")}`]],
];
const NEST_CONTROLLER = /@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
const NEST_ROUTE = /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;

const join2 = (a: string, b: string) => `/${[a, b].map((s) => s.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;

/** Next.js App Router (app/…/route.ts) and Pages API (pages/api/…). */
function nextRoute(rel: string): string | null {
  let m = /(?:^|\/)app\/(.*?)\/?route\.(?:ts|js|tsx|jsx)$/.exec(rel);
  if (m) return `/${m[1]!.split("/").filter((s) => s && !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[\.{3}(\w+)\]$/, "*$1").replace(/^\[(\w+)\]$/, ":$1")).join("/")}`;
  m = /(?:^|\/)pages\/(api\/.*?)\.(?:ts|js|tsx|jsx)$/.exec(rel);
  if (m) return `/${m[1]!.replace(/\/index$/, "").replace(/\[(\w+)\]/g, ":$1")}`;
  return null;
}

export function findRoutes(sources: SourceFile[]): Route[] {
  const out: Route[] = [];
  for (const f of sources) {
    if (isTest(f.rel)) continue;
    // A router's own prefix (FastAPI APIRouter, Flask Blueprint): its decorators' paths hang under it.
    const routerPrefix = f.ext === ".py" ? (/(?:APIRouter|Blueprint)\([^)]*?(?:url_)?prefix\s*=\s*['"]([^'"]+)['"]/.exec(f.text)?.[1] ?? "") : "";
    const next = nextRoute(f.rel);
    if (next) {
      for (const m of f.text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
        out.push({ method: m[1]!, path: next, file: f.rel, line: f.text.slice(0, m.index).split("\n").length, part: f.part });
      }
      if (/pages\/api\//.test(f.rel) && /export\s+default/.test(f.text)) out.push({ method: "ANY", path: next, file: f.rel, line: 1, part: f.part });
    }
    const lines = f.text.split("\n");
    const controller = NEST_CONTROLLER.exec(f.text)?.[1] ?? null;
    lines.forEach((line, i) => {
      if (controller !== null || NEST_CONTROLLER.test(f.text)) {
        const n = NEST_ROUTE.exec(line);
        if (n) return out.push({ method: n[1]!.toUpperCase(), path: join2(controller ?? "", n[2] ?? ""), file: f.rel, line: i + 1, part: f.part });
      }
      for (const [re, pick] of ROUTE_RES) {
        if (f.ext === ".py" && re === ROUTE_RES[3]![0] && !f.rel.endsWith("urls.py")) continue;
        const m = re.exec(line);
        if (m) {
          const [method, path] = pick(m);
          const full = routerPrefix && line.trimStart().startsWith("@") ? join2(routerPrefix, path) : path; // a decorator of this router
          out.push({ method, path: full, file: f.rel, line: i + 1, part: f.part });
          break;
        }
      }
    });
  }
  return out;
}

/** HTTP calls with a literal path: fetch, axios and the usual API-client shapes. */
const CALL_RES: Array<[RegExp, number, number | null]> = [
  [/\bfetch\(\s*[`'"]([^`'"]*)[`'"]\s*(?:,\s*\{[^}]*?method:\s*['"](\w+)['"])?/, 1, 2],
  [/\b(?:axios|api|http|client|request|\$http|instance|apiClient|ky)\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]*)[`'"]/, 2, 1],
  [/\b(?:call|request|apiFetch)<?[^(]*>?\(\s*['"](GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*[`'"]([^`'"]*)[`'"]/, 2, 1],
  [/\brequests\.(get|post|put|patch|delete)\(\s*f?['"]([^'"]*)['"]/, 2, 1],
  // A project's own wrapper with a literal path first: apiFetch("/auth/me", { method: "POST" }), request<T>("/x").
  [/\b(?:\w*[Aa]pi\w*|\w*[Ff]etch\w*|request|http)(?:<[^>()]*>)?\(\s*[`'"](\/[^`'"]*)[`'"](?:[^\n]*?method:\s*['"](\w+)['"])?/, 1, 2],
];

/** The path part of a URL literal: "${BASE}/api/users/${id}" → "/api/users/:x". */
export function callPath(raw: string): string | null {
  const noHost = raw.replace(/^https?:\/\/[^/]+/, "").replace(/^\$\{[^}]*\}/, "");
  if (!noHost.startsWith("/")) return null;
  const p = noHost.split("?")[0]!.replace(/\$\{[^}]*\}/g, ":x").replace(/\{[^}]*\}/g, ":x");
  return p.length > 1 ? p : null;
}

export function findCalls(sources: SourceFile[]): Call[] {
  const out: Call[] = [];
  for (const f of sources) {
    if (isTest(f.rel)) continue;
    f.text.split("\n").forEach((line, i) => {
      for (const [re, pathGroup, methodGroup] of CALL_RES) {
        const m = re.exec(line);
        if (!m) continue;
        const path = callPath(m[pathGroup]!);
        if (path) out.push({ path, method: (methodGroup !== null ? m[methodGroup] : undefined)?.toUpperCase() ?? "GET", file: f.rel, line: i + 1, part: f.part });
        break;
      }
    });
  }
  return out;
}

const pattern = (path: string) => new RegExp(`^${path.replace(/\/+$/, "").replace(/[.+?^$()|[\]\\]/g, "\\$&").replace(/\/(?::\w+|\*\w*|<[^>]+>|\{[^}]+\})/g, "/[^/]+")}/?$`);

/** Which route a call reaches: same path shape (parameters match anything), same method when known. */
export function matchCall(call: Call, routes: Route[]): Route | null {
  const path = call.path.replace(/:x/g, "SEGMENT");
  return routes.find((r) => (r.method === "ANY" || r.method === call.method) && pattern(r.path).test(path))
    ?? routes.find((r) => pattern(r.path).test(path))
    ?? null;
}

// ── environment variables and services ─────────────────────────────────────────────────────────────────────

const ENV_RES = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
  /os\.(?:environ\.get|getenv)\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  /os\.environ\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
  /os\.Getenv\("([A-Z][A-Z0-9_]+)"\)/g,
  /env::var\("([A-Z][A-Z0-9_]+)"\)/g,
];

export function envByPart(sources: SourceFile[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of sources) {
    for (const re of ENV_RES) for (const m of f.text.matchAll(re)) {
      if (!out.has(f.part)) out.set(f.part, new Set());
      out.get(f.part)!.add(m[1]!);
    }
  }
  return out;
}

/** docker-compose services: a small indentation reader, enough for the keys the overview shows. */
export function composeServices(text: string): Service[] {
  const services: Service[] = [];
  const lines = text.replace(/\t/g, "  ").split("\n");
  let inServices = false;
  let svcIndent = -1;
  let cur: Service | null = null;
  let key = "";
  let keyIndent = -1;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    if (indent === 0) {
      inServices = /^services:\s*$/.test(t);
      cur = null;
      continue;
    }
    if (!inServices) continue;
    if (svcIndent < 0) svcIndent = indent;
    if (indent === svcIndent && /^[\w.-]+:\s*$/.test(t)) {
      cur = { name: t.slice(0, -1), ports: [], dependsOn: [], env: [] };
      services.push(cur);
      key = "";
      continue;
    }
    if (!cur) continue;
    const kv = /^([\w-]+):\s*(.*)$/.exec(t);
    if (kv && indent > svcIndent && (keyIndent < 0 || indent <= keyIndent)) {
      key = kv[1]!;
      keyIndent = indent;
      const v = kv[2]!.replace(/^['"]|['"]$/g, "");
      if (key === "image" && v) cur.image = v;
      if (key === "build" && v) cur.build = v;
      if (key === "depends_on" && v.startsWith("[")) cur.dependsOn.push(...v.slice(1, -1).split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean));
      if (key === "ports" && v.startsWith("[")) cur.ports.push(...v.slice(1, -1).split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean));
      continue;
    }
    if (indent > keyIndent) {
      const item = t.startsWith("- ") ? t.slice(2).trim().replace(/^['"]|['"]$/g, "") : null;
      if (key === "ports" && item) cur.ports.push(item);
      if (key === "depends_on") {
        if (item) cur.dependsOn.push(item);
        else if (/^[\w.-]+:\s*$/.test(t) && indent === keyIndent + 2) cur.dependsOn.push(t.slice(0, -1));
      }
      if (key === "environment") {
        const name = item ? item.split("=")[0]! : /^([A-Z][A-Z0-9_]*)\s*:/.exec(t)?.[1];
        if (name && /^[A-Z][A-Z0-9_]*$/.test(name)) cur.env.push(name);
      }
      if (key === "build" && /^context:\s*(\S+)/.test(t)) cur.build = /^context:\s*(\S+)/.exec(t)![1]!;
    }
  }
  return services;
}

// ── the files ──────────────────────────────────────────────────────────────────────────────────────────────

/** The folder tree, to depth 3: files per folder and the main types. */
export function renderTree(files: string[]): string {
  const dirs = new Map<string, { n: number; ext: Map<string, number> }>();
  for (const f of files) {
    const parts = f.split("/");
    for (let d = 1; d <= Math.min(3, parts.length - 1); d++) {
      const key = parts.slice(0, d).join("/");
      const e = dirs.get(key) ?? { n: 0, ext: new Map() };
      e.n++;
      const x = extname(f) || basename(f);
      e.ext.set(x, (e.ext.get(x) ?? 0) + 1);
      dirs.set(key, e);
    }
  }
  const top = files.filter((f) => !f.includes("/"));
  const lines = [`./ — ${top.length} files at the root: ${top.slice(0, 12).join(", ")}${top.length > 12 ? ", …" : ""}`];
  for (const [d, e] of [...dirs].sort(([a], [b]) => a.localeCompare(b))) {
    const depth = d.split("/").length - 1;
    const kinds = [...e.ext].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x, n]) => `${n} ${x}`).join(", ");
    lines.push(`${"  ".repeat(depth)}${d.split("/").at(-1)}/ — ${e.n} files (${kinds})`);
  }
  return lines.join("\n");
}

export interface ProjectIndex {
  /** Output files relative to context/map/ → content. */
  outputs: Map<string, string>;
  stats: { files: number; parts: number; routes: number; calls: number; symbols: number };
}

export function indexProject(repo: string, date: string): ProjectIndex {
  const { files, sources } = walk(repo, describeParts(repo, []));
  const parts = describeParts(repo, files);
  const routes = findRoutes(sources);
  const calls = findCalls(sources);
  const env = envByPart(sources);
  const services = files.filter((f) => /(?:^|\/)(?:docker-)?compose[\w.-]*\.ya?ml$/.test(f) && f.split("/").length <= 2).flatMap((f) => composeServices(read(join(repo, f))).map((s) => ({ ...s, file: f })));
  const envExample = files.filter((f) => /(?:^|\/)\.env\.example$/.test(f)).flatMap((f) => [...read(join(repo, f)).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));

  // Symbols, by part (what `nexo map` always wrote).
  const outputs = new Map<string, string>();
  let symbolCount = 0;
  for (const p of parts) {
    const prefix = p.dir ? `${p.dir}/` : "";
    const fs: FileSymbols[] = sources
      .filter((s) => (prefix ? s.rel.startsWith(prefix) : true) && mappable(s.rel))
      .map((s) => ({ file: s.rel, symbols: symbolsOf(s.text, s.ext) }))
      .filter((f) => f.symbols.length);
    symbolCount += fs.reduce((n, f) => n + f.symbols.length, 0);
    if (fs.length) outputs.set(`symbols/${p.name}.txt`, renderMap(p.name, fs, date));
  }

  // How the parts talk.
  const byPackage = new Map(parts.filter((p) => p.packageName).map((p) => [p.packageName!, p.name]));
  const imports = new Map<string, Set<string>>();
  for (const s of sources) {
    for (const m of s.text.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const spec = m[1]!;
      for (const [pkg, part] of byPackage) {
        if (part !== s.part && (spec === pkg || spec.startsWith(`${pkg}/`))) {
          if (!imports.has(s.part)) imports.set(s.part, new Set());
          imports.get(s.part)!.add(part);
        }
      }
    }
  }
  const httpLinks = new Map<string, { calls: number; examples: string[] }>();
  let unmatched = 0;
  for (const c of calls) {
    const r = matchCall(c, routes);
    if (!r) {
      unmatched++;
      continue;
    }
    if (r.part === c.part) continue; // within a part: not how the parts talk
    const key = `${c.part} → ${r.part}`;
    const e = httpLinks.get(key) ?? { calls: 0, examples: [] };
    e.calls++;
    if (e.examples.length < 3) e.examples.push(`${c.method} ${r.path} (${c.file}:${c.line} → ${r.file}:${r.line})`);
    httpLinks.set(key, e);
  }
  const sharedEnv = new Map<string, string[]>();
  for (const [part, vars] of env) for (const v of vars) sharedEnv.set(v, [...(sharedEnv.get(v) ?? []), part]);

  // README: the overview.
  const langs = new Map<string, number>();
  for (const s of sources) langs.set(s.ext, (langs.get(s.ext) ?? 0) + 1);
  const md: string[] = [
    `# Project index · ${date}`,
    "",
    "Generated by `nexo map` from the code (no AI). Read this first; open the detail files only for what the task needs.",
    "Stale after code changes: `nexo map --check`, then `nexo map`.",
    "",
    `**Files:** ${files.length} (${[...langs].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([x, n]) => `${n} ${x}`).join(", ")}) · **symbols:** ${symbolCount} · **routes:** ${routes.length}`,
    "",
    "## Parts",
    "",
  ];
  for (const p of parts) {
    md.push(`### ${p.name}${p.dir ? ` — \`${p.dir}/\`` : ""}`);
    if (p.packageName) md.push(`- package: \`${p.packageName}\`${p.manifest ? ` (${p.manifest})` : ""}`);
    else if (p.manifest) md.push(`- manifest: ${p.manifest}`);
    if (p.frameworks.length) md.push(`- stack: ${p.frameworks.join(", ")}`);
    if (p.entries.length) md.push(`- entry: ${p.entries.map((e) => `\`${e}\``).join(" · ")}`);
    const vars = [...(env.get(p.name) ?? [])].sort();
    if (vars.length) md.push(`- reads env: ${vars.slice(0, 25).join(", ")}${vars.length > 25 ? `, … (${vars.length})` : ""}`);
    const pr = routes.filter((r) => r.part === p.name);
    if (pr.length) md.push(`- serves ${pr.length} HTTP routes (routes.md)`);
    if (outputs.has(`symbols/${p.name}.txt`)) md.push(`- symbols: \`symbols/${p.name}.txt\``);
    md.push("");
  }
  if (services.length) {
    md.push("## Services (docker compose)", "");
    for (const s of services) {
      md.push(`- **${s.name}** (${s.file})${s.image ? ` image \`${s.image}\`` : ""}${s.build ? ` build \`${s.build}\`` : ""}${s.ports.length ? ` · ports ${s.ports.join(", ")}` : ""}${s.dependsOn.length ? ` · depends on ${s.dependsOn.join(", ")}` : ""}${s.env.length ? ` · env ${s.env.slice(0, 10).join(", ")}${s.env.length > 10 ? ", …" : ""}` : ""}`);
    }
    md.push("");
  }
  md.push("## How the parts talk", "");
  const talk: string[] = [];
  for (const [from, tos] of imports) talk.push(`- **${from}** imports ${[...tos].map((t) => `**${t}**`).join(", ")} (package imports)`);
  for (const [key, e] of [...httpLinks].sort((a, b) => b[1].calls - a[1].calls)) talk.push(`- **${key.replace(" → ", "** calls **")}** over HTTP: ${e.calls} call site(s), e.g. ${e.examples.join("; ")}`);
  const deps = new Map<string, Set<string>>();
  for (const s of services) for (const d of s.dependsOn) deps.set(s.name, (deps.get(s.name) ?? new Set()).add(d));
  for (const [name, ds] of deps) talk.push(`- service **${name}** depends on ${[...ds].map((d) => `**${d}**`).join(", ")} (compose)`);
  for (const [v, ps] of [...sharedEnv].filter(([, ps]) => ps.length > 1).slice(0, 15)) talk.push(`- **${ps.join("**, **")}** share \`${v}\``);
  md.push(...(talk.length ? talk : ["- One part, no compose services: nothing to connect."]));
  if (unmatched) md.push(`- ${unmatched} HTTP call(s) to paths no route here serves (external APIs, or built dynamically)`);
  md.push("");
  if (envExample.length) md.push("## Configuration", "", `\`.env.example\` declares: ${[...new Set(envExample)].join(", ")} (values never copied here).`, "");
  md.push("## Detail files", "", "- `files.md` — the folder tree with file counts", ...(routes.length ? ["- `routes.md` — every HTTP route with file:line"] : []), ...[...outputs.keys()].filter((k) => k.startsWith("symbols/")).map((k) => `- \`${k}\` — functions, classes and types by file`));
  outputs.set("README.md", `${md.join("\n")}\n`);
  outputs.set("files.md", `# Files · ${date}\n\n\`\`\`\n${renderTree(files)}\n\`\`\`\n`);
  if (routes.length) {
    const rm = [`# HTTP routes · ${date}`, ""];
    for (const p of parts) {
      const pr = routes.filter((r) => r.part === p.name);
      if (!pr.length) continue;
      rm.push(`## ${p.name}`, "");
      for (const r of pr) rm.push(`- \`${r.method} ${r.path}\` — ${r.file}:${r.line}`);
      rm.push("");
    }
    outputs.set("routes.md", rm.join("\n"));
  }
  return { outputs, stats: { files: files.length, parts: parts.length, routes: routes.length, calls: calls.length, symbols: symbolCount } };
}


