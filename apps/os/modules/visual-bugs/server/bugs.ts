// Visual-bug gallery: screenshots pasted in agent-os-nexo, kept in one folder (os/data/visual-bugs) so an agent can
// read them all when asked to fix visual bugs. Images live as plain files; notes in index.json beside them.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { httpError } from "../../../host/server/http.ts";

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

let VISUAL_BUGS = "";
let INDEX = "";

/** The folder screenshots live in (this module's data folder). */
export function initBugs(dir: string): void {
  VISUAL_BUGS = dir;
  INDEX = path.join(dir, "index.json");
  mkdirSync(dir, { recursive: true });
}
const NAME = /^bug-\d{8}-\d{6}-\d+\.(png|jpg|gif|webp)$/;

export type VisualBug = { name: string; note: string; createdAt: string; file: string };

function read(): Omit<VisualBug, "file">[] {
  try {
    return JSON.parse(readFileSync(INDEX, "utf8"));
  } catch {
    // Corrupt (not just missing): keep a copy so the next write doesn't silently destroy the notes.
    if (existsSync(INDEX) && !existsSync(`${INDEX}.bak`)) {
      try {
        copyFileSync(INDEX, `${INDEX}.bak`);
      } catch {}
    }
    return [];
  }
}

function write(list: Omit<VisualBug, "file">[]) {
  const tmp = `${INDEX}.tmp`; // write + rename so a crash mid-write can't truncate the index
  writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
  renameSync(tmp, INDEX);
}

/** Newest first; entries whose image was deleted by hand are dropped. */
export function listBugs(): VisualBug[] {
  return read()
    .filter((b) => existsSync(path.join(VISUAL_BUGS, b.name)))
    .map((b) => ({ ...b, file: path.join(VISUAL_BUGS, b.name) }))
    .reverse();
}

export function saveBug(data: Buffer, mime: string, note = ""): VisualBug {
  const ext = IMAGE_TYPES[mime];
  if (!ext) throw httpError(415, `Unsupported format: ${mime}`);
  const list = read();
  const stamp = new Date().toLocaleString("sv-SE").replace(/[-:]/g, "").replace(" ", "-"); // YYYYMMDD-HHMMSS
  let n = list.length + 1;
  while (existsSync(path.join(VISUAL_BUGS, `bug-${stamp}-${n}.${ext}`))) n++; // deletes shrink the list; never overwrite
  const name = `bug-${stamp}-${n}.${ext}`;
  writeFileSync(path.join(VISUAL_BUGS, name), data);
  const entry = { name, note, createdAt: new Date().toISOString() };
  write([...list, entry]);
  return { ...entry, file: path.join(VISUAL_BUGS, name) };
}

export function bugPath(name: string): string | null {
  if (!NAME.test(name)) return null;
  const file = path.join(VISUAL_BUGS, name);
  return existsSync(file) ? file : null;
}

export function setNote(name: string, note: string) {
  const list = read();
  const hit = list.find((b) => b.name === name);
  if (!hit) throw httpError(404, "Screenshot not found");
  hit.note = note;
  write(list);
}

export function deleteBug(name: string) {
  const file = bugPath(name);
  if (file) rmSync(file);
  write(read().filter((b) => b.name !== name));
}
