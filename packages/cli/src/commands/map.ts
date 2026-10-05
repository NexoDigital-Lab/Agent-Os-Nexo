import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { findRoot } from "../core/paths.ts";
import { folder, readConfig } from "../core/config.ts";
import { listProjectDirs } from "../core/projects.ts";
import { ensureDir, writeText } from "../core/fsx.ts";
import { mapFolder, mapParts, renderMap } from "../core/symbols.ts";

/** The project a name ("shop", "crm-ws/api") or the current folder points at. */
function projectFor(root: string, name: string | undefined): string {
  const config = readConfig(root);
  const projects = folder(root, config, "projects");
  const all = listProjectDirs(root, config);
  if (name) {
    const dir = resolve(projects, name);
    if (!all.includes(dir)) throw new Error(`Unknown project "${name}". Projects: ${all.map((d) => relative(projects, d)).join(", ") || "none"}.`);
    return dir;
  }
  const cwd = resolve(process.cwd());
  const here = all.filter((d) => cwd === d || cwd.startsWith(d + "/")).sort((a, b) => b.length - a.length)[0];
  if (!here) throw new Error("Name the project (`nexo map <project>`), or run it inside one.");
  return here;
}

/**
 * Writes context/map/<part>.txt for a project's code/ (symbols by file, see core/symbols.ts) and removes parts
 * that no longer exist. Returns a summary line per part.
 */
export function map(name: string | undefined, opts: { root?: string; check?: boolean }): string {
  const root = findRoot(opts.root);
  const dir = projectFor(root, name);
  if (opts.check) return mapIsStale(dir) ? "The code map is missing or older than the code: run `nexo map`." : "The code map is current.";
  const code = join(dir, "code");
  if (!existsSync(code)) throw new Error(`${relative(root, dir)} has no code/ yet.`);
  const out = join(dir, "context", "map");
  ensureDir(out);
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  const written = new Set<string>();
  for (const part of mapParts(code)) {
    const files = mapFolder(code, part.dir);
    if (!files.length) continue;
    const file = `${part.name}.txt`;
    writeText(join(out, file), renderMap(part.name, files, date));
    written.add(file);
    lines.push(`  context/map/${file}: ${files.length} files, ${files.reduce((n, f) => n + f.symbols.length, 0)} symbols`);
  }
  for (const old of readdirSync(out)) if (old.endsWith(".txt") && !written.has(old)) rmSync(join(out, old));
  return [`Code map of ${relative(join(root, "projects"), dir) || relative(root, dir)} (${date}):`, ...(lines.length ? lines : ["  no symbols found"])].join("\n");
}

/** True when a source file changed after the map was written (agents regenerate it then). */
export function mapIsStale(projectDir: string): boolean {
  const out = join(projectDir, "context", "map");
  if (!existsSync(out)) return true;
  const mapped = Math.min(...readdirSync(out).filter((f) => f.endsWith(".txt")).map((f) => statSync(join(out, f)).mtimeMs));
  if (!Number.isFinite(mapped)) return true;
  const newer = (d: string): boolean =>
    readdirSync(d).some((n) => {
      if (n.startsWith(".") || n === "node_modules" || n === "dist") return false;
      const p = join(d, n);
      const st = statSync(p);
      return st.isDirectory() ? newer(p) : st.mtimeMs > mapped;
    });
  return newer(join(projectDir, "code"));
}
