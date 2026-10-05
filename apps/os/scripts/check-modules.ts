// The mechanical part of the module rules (docs/en/module-rules.md): what a machine can check, it checks here, so a
// review only has to look at what needs judgment. Each finding names its rule, so the fix is in the doc.
//   node scripts/check-modules.ts [--module <id>] [--json]      exit 1 when anything is found
// test/module-rules.test.ts runs it on this repository; `nexo os check` runs it on a personal os/source.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { dependenciesOf, discoverModules, type DiscoveredModule } from "../src/core/modules.ts";

export interface Finding {
  rule: string;
  module: string;
  file: string;
  line?: number;
  message: string;
}

const CODE = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(["node_modules", "dist"]);

function filesOf(dir: string, filter: RegExp, out: string[] = [], root = dir): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    // A submodule is checked on its own: its files are not its parent's.
    if (statSync(p).isDirectory()) {
      if (name === "submodules" && dir === root) continue;
      filesOf(p, filter, out, root);
    } else if (filter.test(name)) out.push(p);
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * Every module a module may lean on: its dependencies, theirs, its parent (for a submodule), itself, and its own
 * submodules (a parent may render them, always behind isActive("<parent>/<sub>"): rule M2 in docs/en/module-rules.md).
 */
function allowedFor(mod: DiscoveredModule, byId: Map<string, DiscoveredModule>): Set<string> {
  const allowed = new Set<string>([mod.id, ...[...byId.values()].filter((m) => m.parent === mod.id).map((m) => m.id)]);
  const stack = [mod.id];
  while (stack.length) {
    const cur = byId.get(stack.pop()!);
    if (!cur) continue;
    for (const dep of [...dependenciesOf(cur), ...(cur.parent ? [cur.parent] : [])]) {
      if (!allowed.has(dep)) {
        allowed.add(dep);
        stack.push(dep);
      }
    }
  }
  return allowed;
}

/** The module a path inside modules/ belongs to ("editor/lsp" for modules/editor/submodules/lsp/...). */
function moduleOfPath(modulesDir: string, abs: string): string | null {
  const rel = relative(modulesDir, abs);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(sep);
  return parts[1] === "submodules" && parts[2] ? `${parts[0]}/${parts[2]}` : parts[0]!;
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
const T_CALL = /(?<![\w.])(?:t|tr|i18n)\(\s*"((?:[^"\\]|\\.)+)"/g;

export function checkModules(appDir: string, only?: string): Finding[] {
  const modulesDir = join(appDir, "modules");
  const { modules, problems } = discoverModules(modulesDir);
  const byId = new Map(modules.map((m) => [m.id, m]));
  const findings: Finding[] = problems.map((message) => ({ rule: "M1", module: "?", file: "modules/", message }));
  const rel = (p: string) => relative(appDir, p);

  // Spanish known anywhere a module can see (its own dictionary, its dependencies', the host's).
  const dictionaries = new Map<string, Record<string, string>>();
  const dictOf = (file: string) => {
    if (!dictionaries.has(file)) {
      const m = /export const es: Record<string, string> = (\{[\s\S]*?\n\});/.exec(existsSync(file) ? readFileSync(file, "utf8") : "");
      // Evaluated as a JS object literal: the files are plain data written by people and by the porting tools.
      dictionaries.set(file, m ? (new Function(`return ${m[1]}`)() as Record<string, string>) : {});
    }
    return dictionaries.get(file)!;
  };
  const hostDict = dictOf(join(appDir, "host", "web", "src", "messages.ts"));

  for (const mod of modules) {
    if (only && mod.id !== only) continue;
    const m = mod.manifest;
    const add = (rule: string, file: string, message: string, line?: number) => findings.push({ rule, module: mod.id, file: rel(file), line, message });
    const manifestFile = join(mod.dir, "module.json");

    // M1 — manifest
    if (!m.owner) add("M1", manifestFile, "owner is missing (nexo or user)");
    for (const [kind, entry] of Object.entries(m.entry ?? {})) {
      if (entry && !existsSync(join(mod.dir, entry))) add("M1", manifestFile, `entry.${kind} points to a missing file: ${entry}`);
    }
    if (m.nav && mod.parent) add("M1", manifestFile, "a submodule cannot have nav (only top-level modules get a rail entry)");
    for (const dep of m.dependsOn ?? []) if (dep === mod.parent) add("M1", manifestFile, `dependsOn lists its parent "${dep}" (implicit for a submodule)`);

    // M2 — imports only from what the module declares
    const allowed = allowedFor(mod, byId);
    const code = filesOf(mod.dir, CODE);
    for (const file of code) {
      const text = readFileSync(file, "utf8");
      for (const hit of text.matchAll(IMPORT)) {
        const spec = hit[1] ?? hit[2]!;
        if (!spec.startsWith(".")) continue;
        const target = resolve(dirname(file), spec);
        const owner = moduleOfPath(modulesDir, target);
        if (owner && !allowed.has(owner)) {
          add("M2", file, `imports "${spec}" from module "${owner}", which is not in dependsOn`, lineOf(text, hit.index!));
        }
        if (!owner && !target.startsWith(appDir + sep)) add("M2", file, `imports "${spec}" from outside agent-os`, lineOf(text, hit.index!));
      }
    }

    // M3 — colors come from the theme (modules/themes); a hardcoded color breaks the other palettes
    if (mod.id !== "themes") {
      for (const file of filesOf(join(mod.dir, "web"), /\.(css|tsx)$/)) {
        const text = readFileSync(file, "utf8");
        for (const hit of text.matchAll(COLOR)) {
          const before = text.slice(Math.max(0, hit.index! - 40), hit.index!);
          if (/\/\/[^\n]*$|\/\*(?![\s\S]*\*\/)[^]*$/.test(before)) continue; // in a comment
          if (/&#?$|[?&=]$/.test(before) || /url\(/.test(before.slice(-20))) continue; // entities, urls
          add("M3", file, `hardcoded color ${hit[0]} — use a theme token (var(--…))`, lineOf(text, hit.index!));
        }
      }
    }

    // M4 — UI text is translated: every literal t("…") has Spanish in a dictionary the module can see
    const webCode = code.filter((f) => f.includes(`${sep}web${sep}`));
    if (webCode.length) {
      const own = join(mod.dir, "web", "messages.ts");
      const known = { ...hostDict };
      for (const id of allowed) {
        const dep = byId.get(id);
        if (dep) Object.assign(known, dictOf(join(dep.dir, "web", "messages.ts")));
      }
      let usesT = false;
      for (const file of webCode) {
        const text = readFileSync(file, "utf8");
        for (const hit of text.matchAll(T_CALL)) {
          usesT = true;
          const key = JSON.parse(`"${hit[1]!}"`) as string; // the literal as JavaScript reads it (\\, \", \n)
          if (!(key in known)) add("M4", file, `t("${key.slice(0, 60)}") has no Spanish in ${rel(own)}`, lineOf(text, hit.index!));
        }
      }
      if (usesT && !existsSync(own)) add("M4", own, "the module translates text but has no web/messages.ts");
      const entry = m.entry?.web ? join(mod.dir, m.entry.web) : null;
      if (usesT && entry && existsSync(entry) && existsSync(own) && !/messages:\s*\{\s*es\b/.test(readFileSync(entry, "utf8"))) {
        add("M4", entry, "defineModule does not register messages: { es }");
      }
    }
  }

  // M5 — one dictionary for everyone: a key translated differently by two modules shows whichever loaded last
  if (!only) {
    const seen = new Map<string, { file: string; text: string }>();
    const sources = [join(appDir, "host", "web", "src", "messages.ts"), ...modules.map((m) => join(m.dir, "web", "messages.ts"))];
    for (const file of sources) {
      for (const [key, text] of Object.entries(dictOf(file))) {
        const prev = seen.get(key);
        if (!prev) seen.set(key, { file, text });
        else if (prev.text !== text) {
          const mod = moduleOfPath(modulesDir, file) ?? "host";
          findings.push({ rule: "M5", module: mod, file: rel(file), message: `"${key}" is "${text}" here but "${prev.text}" in ${rel(prev.file)} — add a context ("${key}::<where>")` });
        }
      }
    }
  }
  return findings;
}

function main() {
  const { values } = parseArgs({ options: { module: { type: "string" }, json: { type: "boolean", default: false }, root: { type: "string" } } });
  const appDir = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const findings = checkModules(appDir, values.module);
  if (values.json) console.log(JSON.stringify(findings, null, 2));
  else if (!findings.length) console.log("Modules follow the rules (docs/en/module-rules.md).");
  else {
    for (const f of findings) console.log(`${f.rule} ${f.file}${f.line ? `:${f.line}` : ""} — ${f.message}`);
    console.log(`\n${findings.length} finding(s). Rules and fixes: docs/en/module-rules.md`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
