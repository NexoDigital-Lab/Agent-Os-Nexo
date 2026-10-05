// File access for the editor, always scoped to a tab's repository (code/ or a worktree).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { httpError, run, trash } from "../../../host/server/http.ts";
import { repoFiles, safePath } from "../../projects/server/repo.ts";
import { IMAGE_RE } from "../shared/fileKinds.ts";

export { repoFiles, safePath };

const MAX_READ = 1024 * 1024;

export type FileEntry = { path: string; lines: number; bytes: number; dir?: true };

/** Folders git can't see because nothing is inside them: the empty leaves under untracked dirs, minus ignored ones. */
async function emptyDirs(root: string): Promise<string[]> {
  const { stdout } = await run("git", ["ls-files", "--others", "--exclude-standard", "--directory"], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  const found: string[] = [];
  const walk = (rel: string, depth: number) => {
    const kids = readdirSync(path.join(root, rel), { withFileTypes: true });
    if (!kids.length) return void found.push(rel);
    if (depth < 8 && found.length < 500)
      for (const k of kids) if (k.isDirectory() && k.name !== ".git" && k.name !== "node_modules") walk(`${rel}/${k.name}`, depth + 1);
  };
  for (const d of stdout.split("\n")) if (d.endsWith("/") && existsSync(path.join(root, d))) walk(d.slice(0, -1), 0);
  if (!found.length) return [];
  // check-ignore prints the ignored ones and exits 1 when none are.
  const ignored = await new Promise<Set<string>>((resolve) => {
    const p = execFile("git", ["check-ignore", "--stdin"], { cwd: root }, (_e, out) => resolve(new Set(String(out).split("\n").filter(Boolean))));
    p.stdin!.end(found.join("\n") + "\n");
  });
  return found.filter((d) => !ignored.has(d));
}

/** Repo-relative paths of tracked + untracked files, minus what .gitignore excludes ([] outside a repo). */
/** Tracked + untracked (not ignored) files with their line counts, plus empty folders. */
export async function listFiles(root: string): Promise<FileEntry[]> {
  const rels = await repoFiles(root);
  const dirs = (await emptyDirs(root)).map((d): FileEntry => ({ path: d, lines: 0, bytes: 0, dir: true }));
  return rels
    .map((rel) => {
      const abs = path.join(root, rel);
      if (!existsSync(abs)) return null;
      const bytes = statSync(abs).size;
      let lines = 0;
      if (bytes < MAX_READ) {
        const buf = readFileSync(abs);
        if (!buf.subarray(0, 8000).includes(0)) lines = buf.toString("utf8").split("\n").length;
      }
      return { path: rel, lines, bytes };
    })
    .filter((f): f is FileEntry => !!f)
    .concat(dirs);
}

export function readText(root: string, rel: string) {
  const abs = safePath(root, rel);
  if (!existsSync(abs)) return { exists: false, content: "" };
  if (statSync(abs).size > MAX_READ) throw httpError(413, "File too large for the editor");
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) throw httpError(415, "Binary file");
  return { exists: true, content: buf.toString("utf8") };
}

export function writeText(root: string, rel: string, content: string) {
  const abs = safePath(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const relOf = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join("/");

/** New empty file or folder. `rel` may include subfolders ("src/utils/date.ts"); never overwrites. */
export function createEntry(root: string, rel: string, kind: "file" | "dir") {
  if (!rel.trim() || rel.endsWith("/")) throw httpError(400, "The name is missing");
  const abs = safePath(root, rel);
  if (abs === root) throw httpError(400, "The name is missing");
  if (existsSync(abs)) throw httpError(409, `${relOf(root, abs)} already exists`);
  if (kind === "dir") mkdirSync(abs, { recursive: true });
  else {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "", { flag: "wx" });
  }
  return { path: relOf(root, abs) };
}

/** Renames in place (same folder). */
export function renameEntry(root: string, from: string, name: string) {
  if (!name.trim() || /[\\/]/.test(name) || name === "." || name === "..") throw httpError(400, "Invalid name (no /)");
  const src = safePath(root, from);
  if (src === root) throw httpError(400, "The root can't be renamed");
  if (!existsSync(src)) throw httpError(404, `${from} no existe`);
  const dest = safePath(root, path.join(path.dirname(from), name));
  if (dest === src) return { path: from };
  // Case-only renames on the same inode are fine; anything else already there is a conflict.
  if (existsSync(dest) && statSync(dest).ino !== statSync(src).ino) throw httpError(409, `${relOf(root, dest)} already exists`);
  renameSync(src, dest);
  return { path: relOf(root, dest) };
}

/** To the desktop trash (recoverable) — never a plain rm. */
export async function deleteEntry(root: string, rel: string) {
  const abs = safePath(root, rel);
  if (abs === root) throw httpError(400, "The root can't be deleted");
  if (!existsSync(abs)) throw httpError(404, `${rel} no existe`);
  await trash(abs, rel);
  return { trashed: true };
}

/** Moves a file or folder into `toDir` (repo-relative, "" = root). Never overwrites, never nests a folder in itself. */
export function moveEntry(root: string, from: string, toDir: string) {
  const src = safePath(root, from);
  const dir = safePath(root, toDir);
  if (src === root) throw httpError(400, "The root can't be moved");
  if (!existsSync(src)) throw httpError(404, `${from} no existe`);
  if (dir === src || dir.startsWith(src + path.sep))
    throw httpError(400, "A folder can't be moved into itself");
  const dest = path.join(dir, path.basename(src));
  if (dest === src) return { path: from };
  if (existsSync(dest)) throw httpError(409, `${relOf(root, dest)} already exists`);
  mkdirSync(dir, { recursive: true });
  renameSync(src, dest);
  return { path: relOf(root, dest) };
}

/** Absolute path of an image inside the repo, for the editor's image preview. */
export function imagePath(root: string, rel: string) {
  if (!IMAGE_RE.test(rel)) throw httpError(415, "Not an image");
  const abs = safePath(root, rel);
  if (!existsSync(abs)) throw httpError(404, `${rel} no existe`);
  return abs;
}
