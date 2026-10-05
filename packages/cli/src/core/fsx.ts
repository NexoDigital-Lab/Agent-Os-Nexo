import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function writeText(path: string, text: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

export function writeJson(path: string, value: unknown): void {
  writeText(path, JSON.stringify(value, null, 2));
}

export function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

export function listDir(path: string): string[] {
  return isDir(path) ? readdirSync(path).sort() : [];
}

/** Copies a directory tree. Existing files are kept unless overwrite is set. */
export function copyDir(src: string, dst: string, overwrite = false): void {
  ensureDir(dst);
  for (const entry of listDir(src)) {
    const from = join(src, entry);
    const to = join(dst, entry);
    if (isDir(from)) copyDir(from, to, overwrite);
    else if (overwrite || !existsSync(to)) copyFileSync(from, to);
  }
}

/** Replaces {{key}} placeholders. Unknown keys are left untouched. */
export function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

/** Copies a template tree, rendering placeholders in every text file. */
export function copyTemplate(src: string, dst: string, vars: Record<string, string>): void {
  ensureDir(dst);
  for (const entry of listDir(src)) {
    const from = join(src, entry);
    const to = join(dst, entry);
    if (isDir(from)) copyTemplate(from, to, vars);
    else if (!existsSync(to)) writeFileSync(to, render(readText(from), vars));
  }
}
