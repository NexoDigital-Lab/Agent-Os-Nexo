import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { findRoot } from "../core/paths.ts";
import { folder, readConfig } from "../core/config.ts";
import { listProjectDirs } from "../core/projects.ts";
import { ensureDir, writeText } from "../core/fsx.ts";
import { indexProject } from "../core/projectIndex.ts";

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
 * Writes the project index into context/map/ (core/projectIndex.ts): README.md (overview: parts, stack, entry
 * points, services, API, how the parts talk), files.md, routes.md and symbols/<part>.txt. Files a previous run
 * wrote that this one did not are removed.
 */
export function map(name: string | undefined, opts: { root?: string; check?: boolean }): string {
  const root = findRoot(opts.root);
  const dir = projectFor(root, name);
  if (opts.check) return mapIsStale(dir) ? "The code map is missing or older than the code: run `nexo map`." : "The code map is current.";
  return writeIndex(dir, root);
}

/** Indexes one project folder (holding code/); returns a summary. Also used right after `nexo clone`. */
export function writeIndex(dir: string, root: string): string {
  const code = join(dir, "code");
  if (!existsSync(code)) throw new Error(`${relative(root, dir)} has no code/ yet.`);
  const out = join(dir, "context", "map");
  const date = new Date().toISOString().slice(0, 10);
  const { outputs, stats } = indexProject(code, date);
  rmSync(out, { recursive: true, force: true }); // all of it is generated: start clean
  for (const [rel, text] of outputs) {
    ensureDir(dirname(join(out, rel)));
    writeText(join(out, rel), text);
  }
  const symbols = [...outputs.keys()].filter((k) => k.startsWith("symbols/")).length;
  return `Indexed ${relative(join(root, "projects"), dir)} in context/map/: ${stats.files} files, ${stats.parts} part(s), ${stats.symbols} symbols in ${symbols} file(s), ${stats.routes} routes, ${stats.calls} HTTP calls.`;
}

/** True when a source file changed after the map was written (agents regenerate it then). */
export function mapIsStale(projectDir: string): boolean {
  const out = join(projectDir, "context", "map");
  if (!existsSync(out)) return true;
  const index = join(out, "README.md");
  const mapped = existsSync(index) ? statSync(index).mtimeMs : NaN;
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
