// The user's dictionary: one Markdown file per concept in library/dictionary/, so no agent asks twice what a word
// means. Frontmatter `term`, `aliases`, `summary`, `owner`, `updated`; the definition is the body. `nexo dict` and
// agent-os write it through here, so the format and library/index.json stay the same whoever saves a term.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import { listDir, readText, writeText } from "./fsx.ts";

export interface Term {
  term: string;
  aliases: string[];
  summary: string;
  owner: string;
  updated: string;
  /** Relative to library/: dictionary/<slug>.md */
  path: string;
  body: string;
}

export interface TermInput {
  term: string;
  /** Rename: the term (or alias) to update, when `term` is its new name. Without it, the existing name is kept. */
  from?: string;
  summary?: string;
  aliases?: string[];
  body?: string;
}

const DIR = "dictionary";
const MAX_TERM = 80;
const MAX_SUMMARY = 240;

/** Lowercase, no accents, a–z 0–9 and dashes: the file name, and how terms and aliases are compared. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function cleanAlias(alias: string): string {
  // The frontmatter list is `[a, b]`: commas and brackets inside an alias would split or end it.
  return oneLine(alias.replace(/[,[\]]/g, " "));
}

function read(libraryDir: string, file: string): Term {
  const rel = join(DIR, file);
  const { data, body } = parseFrontmatter(readText(join(libraryDir, rel)));
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
  return {
    term: String(data.term ?? file.replace(/\.md$/, "")),
    aliases: list(data.aliases),
    summary: String(data.summary ?? ""),
    owner: String(data.owner ?? "user"),
    updated: String(data.updated ?? ""),
    path: rel,
    body: body.trim(),
  };
}

/** Every term, alphabetical. README.md (the folder's explanation) is not a term. */
export function listTerms(libraryDir: string): Term[] {
  return listDir(join(libraryDir, DIR))
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .map((f) => read(libraryDir, f))
    .sort((a, b) => a.term.localeCompare(b.term));
}

/** A term by its name or one of its aliases, ignoring case and accents. */
export function findTerm(libraryDir: string, name: string): Term | null {
  const key = slugify(name);
  if (!key) return null;
  return listTerms(libraryDir).find((t) => slugify(t.term) === key || t.aliases.some((a) => slugify(a) === key)) ?? null;
}

function render(t: Omit<Term, "path">): string {
  const lines = [
    "---",
    `term: ${t.term}`,
    `aliases: [${t.aliases.join(", ")}]`,
    `summary: ${t.summary}`,
    `owner: ${t.owner}`,
    `updated: ${t.updated}`,
    "---",
    "",
    t.body ? `${t.body}\n` : "",
  ];
  return lines.join("\n");
}

/**
 * Creates the term, or updates the one with that name or alias: the summary and body are replaced when given,
 * the aliases merged. Returns it as saved.
 */
export function saveTerm(libraryDir: string, input: TermInput, today = new Date().toISOString().slice(0, 10)): Term & { created: boolean } {
  const term = oneLine(input.term);
  if (!slugify(term)) throw new Error("A term needs at least one letter or digit.");
  if (term.length > MAX_TERM) throw new Error(`A term is at most ${MAX_TERM} characters.`);
  const summary = input.summary === undefined ? undefined : oneLine(input.summary);
  if (summary && summary.length > MAX_SUMMARY) throw new Error(`The summary is one line of at most ${MAX_SUMMARY} characters.`);
  const aliases = (input.aliases ?? []).map(cleanAlias).filter(Boolean);

  const existing = input.from !== undefined
    ? findTerm(libraryDir, input.from) ?? (() => { throw new Error(`No term "${input.from}" to rename.`); })()
    : findTerm(libraryDir, term) ?? aliases.map((a) => findTerm(libraryDir, a)).find(Boolean) ?? null;
  if (!existing && !summary) throw new Error(`"${term}" is new: give it a summary (one line saying what it means).`);
  // An update keeps the existing name (saving "activo" updates "Cliente activo"); only a rename changes it.
  const name = existing && input.from === undefined ? existing.term : term;
  if (input.from !== undefined) {
    const clash = findTerm(libraryDir, term);
    if (clash && clash.path !== existing?.path) throw new Error(`"${term}" is already the term "${clash.term}".`);
  }
  const merged = [...(existing?.aliases ?? []), ...aliases, ...(existing && input.from === undefined ? [term] : [])];
  const seen = new Set([slugify(name)]);
  const next = {
    term: name,
    aliases: merged.filter((a) => (seen.has(slugify(a)) ? false : (seen.add(slugify(a)), true))),
    summary: summary ?? existing?.summary ?? "",
    owner: existing?.owner ?? "user",
    updated: today,
    body: input.body === undefined ? existing?.body ?? "" : input.body.trim(),
  };

  const base = slugify(name);
  let rel = existing?.path;
  if (rel && input.from !== undefined && rel !== join(DIR, `${base}.md`) && !existsSync(join(libraryDir, DIR, `${base}.md`))) {
    rmSync(join(libraryDir, rel)); // renamed: the file follows the new name
    rel = undefined;
  }
  if (!rel) {
    let n = 1;
    rel = join(DIR, `${base}.md`);
    while (existsSync(join(libraryDir, rel))) rel = join(DIR, `${base}-${++n}.md`);
  }
  writeText(join(libraryDir, rel), render(next));
  return { ...next, path: rel, created: !existing };
}

/** Deletes a term (by name or alias); returns the one removed. */
export function removeTerm(libraryDir: string, name: string): Term {
  const found = findTerm(libraryDir, name);
  if (!found) throw new Error(`No term "${name}" in library/dictionary/.`);
  rmSync(join(libraryDir, found.path));
  return found;
}
