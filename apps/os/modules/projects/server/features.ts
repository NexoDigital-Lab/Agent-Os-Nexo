// A project's features: one Markdown file each in context/features/, with a small frontmatter block
// (the format the nexo-features skill writes). The board, the sidebar and the agents all read the same files.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FEATURE_TYPES = ["feature", "bug", "chore"] as const;
export const FEATURE_STATUSES = ["todo", "doing", "done"] as const;
export const FEATURE_SIZES = ["S", "M", "L"] as const;

export interface Feature {
  /** File name without .md: "0007-refresh-tokens". */
  slug: string;
  id: string;
  title: string;
  type: (typeof FEATURE_TYPES)[number];
  size: (typeof FEATURE_SIZES)[number];
  status: (typeof FEATURE_STATUSES)[number];
  link: string;
  created: string;
  mtime: number;
}

const SLUG = /^[\w.-]+$/;

export const featuresDir = (projectDir: string) => join(projectDir, "context", "features");

/** key: value pairs between the leading --- lines; quotes stripped. */
export function frontmatter(text: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

export function parseFeature(slug: string, text: string, mtime: number): Feature {
  const fm = frontmatter(text);
  const heading = /^#\s+(.+)$/m.exec(text)?.[1];
  return {
    slug,
    id: fm.id ?? (/^(\d+)-/.exec(slug)?.[1] ?? ""),
    title: fm.title || heading || slug,
    type: pick(fm.type === "fix" ? "bug" : fm.type, FEATURE_TYPES, "feature"),
    size: pick(fm.size, FEATURE_SIZES, "M"),
    status: pick(fm.status, FEATURE_STATUSES, "todo"),
    link: fm.link ?? "",
    created: fm.created ?? "",
    mtime,
  };
}

/** Newest first. */
export function listFeatures(projectDir: string): Feature[] {
  const dir = featuresDir(projectDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => {
      const full = join(dir, f);
      return parseFeature(f.slice(0, -3), readFileSync(full, "utf8"), statSync(full).mtimeMs);
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function readFeature(projectDir: string, slug: string): string | null {
  if (!SLUG.test(slug)) return null;
  const file = join(featuresDir(projectDir), `${slug}.md`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** The next id: highest number in context/features/ + 1, zero-padded ("0007"). */
export function nextFeatureId(projectDir: string): string {
  const max = listFeatures(projectDir).reduce((m, f) => Math.max(m, Number.parseInt(f.id, 10) || 0), 0);
  return String(max + 1).padStart(4, "0");
}

const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "feature";

export interface NewFeature {
  title: string;
  type: Feature["type"];
  size: Feature["size"];
  status?: Feature["status"];
  context?: string;
  criteria?: string[];
  files?: string[];
  assumptions?: string;
}

/** Writes a feature in the nexo-features format and returns its slug. */
export function writeFeature(projectDir: string, f: NewFeature): string {
  const id = nextFeatureId(projectDir);
  const slug = `${id}-${slugify(f.title)}`;
  const dir = featuresDir(projectDir);
  mkdirSync(dir, { recursive: true });
  const text = `---
id: "${id}"
title: ${f.title.replace(/\n/g, " ")}
type: ${f.type}
size: ${f.size}
status: ${f.status ?? "todo"}
link:
created: ${new Date().toLocaleDateString("sv-SE")}
---

## Context
${f.context?.trim() || "_To be completed._"}

## Acceptance criteria
${(f.criteria?.length ? f.criteria : ["_To be defined._"]).map((c) => `- [ ] ${c}`).join("\n")}

## Likely files
${(f.files?.length ? f.files : ["_Unknown yet._"]).map((p) => `- \`${p}\``).join("\n")}

## Assumptions and open questions
${f.assumptions?.trim() || ""}
`;
  writeFileSync(join(dir, `${slug}.md`), text);
  return slug;
}

/** Updates one frontmatter field (e.g. status) in place, keeping the rest of the file. */
export function setFeatureField(projectDir: string, slug: string, key: "status" | "size" | "type", value: string): void {
  const text = readFeature(projectDir, slug);
  if (text === null) throw new Error(`No feature ${slug}`);
  const re = new RegExp(`^(${key}:).*$`, "m");
  const next = re.test(text) ? text.replace(re, `$1 ${value}`) : text.replace(/^---\r?\n/, `---\n${key}: ${value}\n`);
  writeFileSync(join(featuresDir(projectDir), `${slug}.md`), next);
}
