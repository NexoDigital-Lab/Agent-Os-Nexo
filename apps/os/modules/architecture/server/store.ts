// Architecture: what the user wants the project to look like (doc + proposed folder tree), kept in the project's
// context/architecture/. It is a plan — nothing here ever touches the real repository.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { httpError } from "../../../host/server/http.ts";
import { projectDir, projectPath } from "../../projects/server/projects.ts";
import type { ArchAdvice, ArchChatMsg, ArchDoc, ArchNode, ArchTree } from "./types.ts";

const MAX_NODES = 500;
const MAX_DOC = 200 * 1024;
const MAX_RULES = 50 * 1024;
export const MAX_CHAT = 40;
const PART_CAP = 6 * 1024; // doc and tree are capped apart so a long doc can't push the folder rules out
const NAME_RE = /^[A-Za-z0-9._@-][A-Za-z0-9._@ -]{0,79}$/;
// Real folders that are never part of a plan: dependencies, build output, caches, VCS.
const IMPORT_IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".venv", "venv", "__pycache__", "vendor", "target", "coverage", ".turbo", ".cache"]);
const IMPORT_DEPTH = 3;

export const template = (project: string) => `# Architecture · ${project}\n\n## Layers\n- \n\n## Rules\n- \n\n## Conventions\n- \n\n## Notes\n`;

/** <project>/context/architecture/, 404 when the project isn't known. */
export function dirOf(project: string) {
  const dir = projectDir(project);
  if (!dir) throw httpError(404, `Unknown project: ${project}`);
  return path.join(dir, "context", "architecture");
}

// Atomic: a crash mid-write must not leave half a JSON behind.
function writeAtomic(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

const newId = () => crypto.randomUUID().slice(0, 8);

/** Checks and normalizes a tree from the client: throws 400 on anything that could corrupt the plan. */
export function validateTree(input: unknown): ArchTree {
  const raw = (input as ArchTree | undefined)?.nodes;
  if (!Array.isArray(raw)) throw httpError(400, "Invalid tree");
  if (raw.length > MAX_NODES) throw httpError(400, `Too many folders (at most ${MAX_NODES})`);
  const ids = new Set<string>();
  const nodes: ArchNode[] = raw.map((n) => {
    const id = String(n?.id ?? "").trim();
    if (!id || id.length > 64) throw httpError(400, "Folder without a valid id");
    if (ids.has(id)) throw httpError(400, `Repeated id: ${id}`);
    ids.add(id);
    const name = String(n.name ?? "").trim();
    if (!NAME_RE.test(name) || name.includes("..") || name === ".") throw httpError(400, `Invalid folder name: "${name}"`);
    const rules = String(n.rules ?? "");
    if (rules.length > MAX_RULES) throw httpError(400, `The rules of "${name}" are too long`);
    return { id, name, parentId: n.parentId == null ? null : String(n.parentId), rules };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.parentId !== null && !byId.has(n.parentId)) throw httpError(400, `"${n.name}" points to a folder that does not exist`);
    const key = `${n.parentId}/${n.name.toLowerCase()}`; // case-insensitive: the real folders may live on any filesystem
    if (seen.has(key)) throw httpError(400, `Repeated name among siblings: "${n.name}"`);
    seen.add(key);
  }
  // Walking up from every node: reaching more steps than nodes means we looped.
  for (const n of nodes) {
    let cur: ArchNode | undefined = n;
    for (let i = 0; cur?.parentId != null; i++) {
      if (i > nodes.length) throw httpError(400, `Cycle in the tree (from "${n.name}")`);
      cur = byId.get(cur.parentId);
    }
  }
  return { nodes };
}

/** Adds the folder paths (each a name list from the root) missing from `tree`; never removes or renames anything. */
export function mergeDirs(tree: ArchTree, dirs: string[][]): ArchTree {
  const nodes = [...tree.nodes];
  const find = (parentId: string | null, name: string) => nodes.find((n) => n.parentId === parentId && n.name.toLowerCase() === name.toLowerCase());
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) {
    let parent: string | null = null;
    for (const name of dir) {
      let node = find(parent, name);
      if (!node) {
        if (nodes.length >= MAX_NODES || !NAME_RE.test(name) || name.includes("..")) break;
        node = { id: newId(), name, parentId: parent, rules: "" };
        nodes.push(node);
      }
      parent = node.id;
    }
  }
  return { nodes };
}

/** The repo's real folders up to depth 3, as name paths from the root. */
export function realDirs(repo: string): string[][] {
  const found: string[][] = [];
  const walk = (rel: string[]) => {
    if (rel.length >= IMPORT_DEPTH) return;
    let kids;
    try {
      kids = readdirSync(path.join(repo, ...rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const k of kids.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!k.isDirectory() || IMPORT_IGNORE.has(k.name)) continue;
      found.push([...rel, k.name]);
      walk([...rel, k.name]);
    }
  };
  walk([]);
  return found;
}

// ---- reading / writing
const file = (project: string, name: string) => path.join(dirOf(project), name);

/** Parsed JSON accepted by `ok`, else `fallback`. `bak` = copy the unreadable file to <file>.bak once, so the user can recover it. */
export function readChecked<T>(f: string, ok: (v: unknown) => v is T, fallback: T, bak = false): T {
  if (!existsSync(f)) return fallback;
  try {
    const v: unknown = JSON.parse(readFileSync(f, "utf8"));
    if (ok(v)) return v;
  } catch {}
  if (bak && !existsSync(`${f}.bak`)) {
    try {
      copyFileSync(f, `${f}.bak`);
    } catch {}
  }
  return fallback;
}

export const isTree = (v: unknown): v is ArchTree => {
  try {
    validateTree(v);
    return true;
  } catch {
    return false;
  }
};
const isAdvice = (v: unknown): v is ArchAdvice => !!v && typeof v === "object" && Array.isArray((v as ArchAdvice).steps) && typeof (v as ArchAdvice).summary === "string";
const isChat = (v: unknown): v is ArchChatMsg[] => Array.isArray(v) && v.every((m) => m && typeof m.text === "string" && (m.role === "user" || m.role === "assistant"));

export function readArch(project: string): ArchDoc {
  const doc = file(project, "architecture.md");
  const treeFile = file(project, "tree.json");
  return {
    project,
    exists: existsSync(doc) || existsSync(treeFile),
    markdown: existsSync(doc) ? readFileSync(doc, "utf8") : template(project),
    tree: readChecked(treeFile, isTree, { nodes: [] }, true),
    advice: readChecked<ArchAdvice | null>(file(project, "advice.json"), isAdvice, null),
    chat: readChecked(file(project, "chat.json"), isChat, []),
  };
}

export function writeDoc(project: string, markdown: unknown) {
  if (typeof markdown !== "string") throw httpError(400, "Missing the document text");
  if (markdown.length > MAX_DOC) throw httpError(413, "The document is too large (at most 200 KB)");
  writeAtomic(file(project, "architecture.md"), markdown);
}

export function writeTree(project: string, input: unknown): ArchTree {
  const tree = validateTree(input);
  writeAtomic(file(project, "tree.json"), JSON.stringify(tree, null, 2));
  return tree;
}

/** Seeds the tree with the repo's real folders that aren't in it yet. */
export function importTree(project: string): ArchTree {
  const repo = projectPath(project);
  if (!repo) throw httpError(404, `The project has no code/ yet: ${project}`);
  return writeTree(project, mergeDirs(readArch(project).tree, realDirs(repo)));
}

export const writeAdvice = (project: string, advice: ArchAdvice) => writeAtomic(file(project, "advice.json"), JSON.stringify(advice, null, 2));

export const writeChat = (project: string, messages: ArchChatMsg[]) => writeAtomic(file(project, "chat.json"), JSON.stringify(messages.slice(-MAX_CHAT), null, 2));

// ---- what the agent sees
/** A doc is "real" once it has anything besides the template's headings and empty bullets. */
const hasContent = (markdown: string) => markdown.split("\n").some((l) => !/^\s*(#.*|-\s*)?$/.test(l));

/** The tree as an indented list, each folder followed by its rules. */
function treeText(tree: ArchTree) {
  const out: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of tree.nodes.filter((x) => x.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) {
      const pad = "  ".repeat(depth);
      out.push(`${pad}- ${n.name}/`);
      if (n.rules.trim()) out.push(...n.rules.trim().split("\n").map((l) => `${pad}    ${l}`));
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.join("\n");
}

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text);

/** The text that makes the agent follow the architecture; "" when none was defined (template only, no folders). */
export function promptFrom(markdown: string, tree: ArchTree): string {
  const doc = hasContent(markdown) ? markdown.trim() : "";
  if (!doc && !tree.nodes.length) return "";
  const parts = ["Architecture the user defined for this project — follow it; if something asked contradicts it, say so before doing it:"];
  if (doc) parts.push(cap(doc, PART_CAP));
  if (tree.nodes.length) parts.push(`Proposed folder structure (with the rules of each folder):\n${cap(treeText(tree), PART_CAP)}`);
  return parts.join("\n\n");
}

export function architecturePrompt(project: string): string {
  try {
    const { markdown, tree } = readArch(project);
    return promptFrom(markdown, tree);
  } catch {
    return ""; // an unknown project or unreadable files must never break a the agent turn
  }
}
