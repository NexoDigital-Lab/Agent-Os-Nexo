// A project's context — AGENTS.md and context/ — for the Context view: list the documents, read and save them, open
// them in VS Code. Only those two places: secrets/ and code/ are never listed or served from here, and
// context/permissions.json is read-only (its changes go through `nexo permissions`, which validates them).
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join, posix, relative, sep } from "node:path";
import { httpError } from "../../../host/server/http.ts";
import { projectDir } from "../../projects/server/projects.ts";
import { safePath } from "../../projects/server/repo.ts";

export interface ContextFile {
  /** Relative to the project folder, with forward slashes: "AGENTS.md", "context/features/0001-x.md". */
  path: string;
  size: number;
  readOnly: boolean;
}

export interface ContextDoc extends ContextFile {
  content: string;
  /** Last change (ms); a save that carries an older one is refused (someone else changed it). */
  mtime: number;
}

const TEXT = new Set([".md", ".json", ".txt", ".yml", ".yaml", ".toml", ".csv"]);
const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 2000;
const READ_ONLY = new Set(["context/permissions.json"]);
const slash = (p: string) => p.split(sep).join("/");

export function dirOf(project: string): string {
  const dir = projectDir(project);
  if (!dir) throw httpError(404, `Unknown project: ${project}`);
  return dir;
}

/**
 * `rel` normalized ("context/../secrets/x" is "secrets/x") and checked to be AGENTS.md or under context/ (or
 * context/ itself when `folder` is allowed), with forward slashes.
 */
export function contextPath(rel: string, folder = false): string {
  const path = posix.normalize(rel.replace(/\\/g, "/")).replace(/^\.\//, ""); // backslashes too, on every platform
  const ok = path === "AGENTS.md" || (path.startsWith("context/") && !path.startsWith("context/../")) || (folder && path === "context");
  if (!ok || path.startsWith("/") || path.includes("\0")) throw httpError(400, "Only AGENTS.md and files under context/");
  return path;
}

/** "AGENTS.md" or a text file under context/, never a symlink or anything else. Returns the absolute path. */
function resolveDoc(dir: string, rel: unknown): { abs: string; path: string } {
  if (typeof rel !== "string" || !rel || rel.length > 300) throw httpError(400, "path is required");
  const path = contextPath(rel);
  if (!TEXT.has(extname(path).toLowerCase())) throw httpError(400, `Only text documents (${[...TEXT].join(", ")})`);
  const abs = safePath(dir, path);
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) throw httpError(400, "Symbolic links are not opened from here");
  return { abs, path };
}

export function listContext(project: string): ContextFile[] {
  const dir = dirOf(project);
  const out: ContextFile[] = [];
  const add = (abs: string) => {
    const path = slash(relative(dir, abs));
    out.push({ path, size: statSync(abs).size, readOnly: READ_ONLY.has(path) });
  };
  if (existsSync(join(dir, "AGENTS.md"))) add(join(dir, "AGENTS.md"));
  const walk = (folder: string, depth: number) => {
    if (depth > 8 || !existsSync(folder)) return;
    // A folder's own files first, then its subfolders: context/README.md comes before context/features/….
    const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      const abs = join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(abs, depth + 1);
      else if (entry.isFile() && TEXT.has(extname(entry.name).toLowerCase())) add(abs);
    }
  };
  walk(join(dir, "context"), 0);
  return out;
}

export function readDoc(project: string, rel: unknown): ContextDoc {
  const { abs, path } = resolveDoc(dirOf(project), rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw httpError(404, `No document ${path}`);
  const st = statSync(abs);
  if (st.size > MAX_BYTES) throw httpError(413, `${path} is larger than 1 MB: open it in VS Code`);
  return { path, size: st.size, readOnly: READ_ONLY.has(path), content: readFileSync(abs, "utf8"), mtime: st.mtimeMs };
}

/** Saves (or creates) a document atomically. `mtime`, when given, must match the file on disk. */
export function writeDoc(project: string, body: unknown): ContextDoc {
  const b = (body ?? {}) as { path?: unknown; content?: unknown; mtime?: unknown };
  const dir = dirOf(project);
  const { abs, path } = resolveDoc(dir, b.path);
  if (READ_ONLY.has(path)) throw httpError(403, "Permissions are changed in Settings → Agent permissions (or `nexo permissions`), which validates them");
  if (typeof b.content !== "string") throw httpError(400, "content must be text");
  if (Buffer.byteLength(b.content) > MAX_BYTES) throw httpError(413, "A document is at most 1 MB");
  if (existsSync(abs)) {
    if (typeof b.mtime === "number" && Math.abs(statSync(abs).mtimeMs - b.mtime) > 1) throw httpError(409, `${path} changed on disk since you opened it: reload it`);
  } else if (!existsSync(join(abs, ".."))) {
    throw httpError(400, "The folder does not exist");
  }
  const tmp = `${abs}.${process.pid}.tmp`;
  writeFileSync(tmp, b.content);
  renameSync(tmp, abs);
  return readDoc(project, path);
}

/** One line for the agents of a project tab: where its context is, so they read it instead of searching. */
export function promptNote(project: string): string | null {
  const dir = projectDir(project);
  if (!dir || !existsSync(join(dir, "context"))) return null;
  const has = (p: string) => existsSync(join(dir, "context", p));
  const parts = [
    has("README.md") && "context/README.md (start here)",
    has("map/README.md") && "context/map/README.md (code map)",
    has("features") && "context/features/",
    has("infra.md") && "context/infra.md (how to run and validate)",
  ].filter(Boolean);
  return parts.length ? `Project context (outside code/): ${parts.join(", ")}. Read it before exploring; the user edits it in the Context view.` : null;
}
