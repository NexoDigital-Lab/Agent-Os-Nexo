// Search & replace across a repo (the editor's Ctrl+Shift+F): git grep to find, JS regex to replace.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { httpError, run } from "../../../host/server/http.ts";
import { safePath } from "../../projects/server/repo.ts";

const MAX_READ = 1024 * 1024;

export type SearchOpts = { q: string; regex?: boolean; matchCase?: boolean; word?: boolean };
export type SearchHit = { path: string; line: number; col: number; text: string };

/** git grep: tracked + untracked, skips ignored and binary files. */
export async function searchRepo(root: string, o: SearchOpts): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  if (!o.q) return { hits: [], truncated: false };
  const args = ["grep", "-n", "-I", "--column", "--untracked", "--no-color", "--full-name", o.regex ? "-E" : "-F"];
  if (!o.matchCase) args.push("-i");
  if (o.word) args.push("-w");
  args.push("-e", o.q);
  const out = await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }).then(
    (r) => r.stdout,
    (e) => {
      if (e.code === 1) return ""; // no matches
      throw httpError(400, `Invalid search: ${String(e.stderr || e.message).trim()}`);
    },
  );
  const hits: SearchHit[] = [];
  for (const l of out.split("\n")) {
    const m = l.match(/^(.+?):(\d+):(\d+):(.*)$/);
    if (m) hits.push({ path: m[1], line: +m[2], col: +m[3], text: m[4].slice(0, 300) });
    if (hits.length >= 2000) break;
  }
  return { hits, truncated: hits.length >= 2000 };
}

const toRegExp = (o: SearchOpts) => {
  const src = o.regex ? o.q : o.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(o.word ? `\\b(?:${src})\\b` : src, o.matchCase ? "g" : "gi");
};

/** Replaces in the given files only (the ones you left ticked in the results). */
export function replaceInRepo(root: string, o: SearchOpts & { replacement: string; files: string[] }) {
  if (!o.q) throw httpError(400, "Nothing to search for");
  let re: RegExp;
  try {
    re = toRegExp(o);
  } catch (e: any) {
    throw httpError(400, `Invalid regex: ${e.message}`);
  }
  const changed: { path: string; count: number }[] = [];
  for (const rel of o.files ?? []) {
    const abs = safePath(root, rel);
    if (!existsSync(abs) || statSync(abs).size > MAX_READ) continue;
    const before = readFileSync(abs, "utf8");
    let count = 0;
    const after = before.replace(re, (...m) => {
      count++;
      // $1…$n / $& in the replacement, like VS Code with regex on.
      return o.regex ? o.replacement.replace(/\$(\d+|&)/g, (_, g) => (g === "&" ? m[0] : m[Number(g)] ?? "")) : o.replacement;
    });
    if (count) {
      writeFileSync(abs, after);
      changed.push({ path: rel, count });
    }
  }
  return { changed, total: changed.reduce((n, c) => n + c.count, 0) };
}
