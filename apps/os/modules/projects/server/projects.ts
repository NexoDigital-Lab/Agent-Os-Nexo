// The environment's projects: projects/<name>/ or projects/<ws>-ws/<part>/, each with AGENTS.md, code/
// (the repository), context/ and secrets/. A project's id is its path under projects/ ("api-ws/web").
// These lookups are the only way an id from a request reaches the filesystem.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Env } from "../../../host/server/env.ts";
import { git } from "./git.ts";
import { listFeatures, type Feature } from "./features.ts";

let root = "";

/** Called once by the module's register(): where projects/ is. */
export function initProjects(env: Env): void {
  root = env.projects;
}

export const projectsRoot = () => root;

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const subdirs = (p: string) => (isDir(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);

/** Every project id: folders with an AGENTS.md, and the parts of each <ws>-ws workspace. */
export function projectIds(): string[] {
  const ids: string[] = [];
  for (const name of subdirs(root)) {
    const dir = join(root, name);
    if (name.endsWith("-ws")) {
      for (const part of subdirs(dir)) if (existsSync(join(dir, part, "AGENTS.md"))) ids.push(`${name}/${part}`);
    } else if (existsSync(join(dir, "AGENTS.md"))) {
      ids.push(name);
    }
  }
  return ids;
}

/** The project folder (AGENTS.md, code/, context/…) for a known id, or null. */
export function projectDir(id: string): string | null {
  return projectIds().includes(id) ? join(root, id) : null;
}

/** The repository (code/) of a known project, or null. */
export function projectPath(id: string): string | null {
  const dir = projectDir(id);
  return dir && isDir(join(dir, "code")) ? join(dir, "code") : null;
}

/** The workspace folder (<ws>-ws) a part belongs to, or null for a standalone project. */
export function workspaceOf(id: string): string | null {
  return id.includes("/") ? join(root, id.split("/")[0]!) : null;
}

/** worktrees/<name> folders of a project whose .git file points back into code/.git/worktrees/. */
export function worktreeNames(id: string): string[] {
  const dir = projectDir(id);
  if (!dir) return [];
  const home = join(dir, "code", ".git", "worktrees") + sep;
  const base = join(dir, "worktrees");
  return subdirs(base).filter((name) => {
    const dotgit = join(base, name, ".git");
    if (!existsSync(dotgit) || statSync(dotgit).isDirectory()) return false;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, "utf8"))?.[1]?.trim();
    return !!gitdir && resolve(base, name, gitdir).startsWith(home);
  });
}

/** A worktree folder of a project, or null — same gatekeeping as projectPath. */
export function worktreePath(id: string, wt: string): string | null {
  const dir = projectDir(id);
  return dir && worktreeNames(id).includes(wt) ? join(dir, "worktrees", wt) : null;
}

export interface Worktree {
  name: string;
  path: string;
  branch: string;
  changed: number;
}

export interface Project {
  /** Path under projects/: "gestor-gastos" or "empty-box-ws/api". */
  id: string;
  /** Last segment of the id. */
  name: string;
  /** "empty-box" for a part of empty-box-ws, null for a standalone project. */
  workspace: string | null;
  /** The project folder. */
  dir: string;
  /** The repository (code/), or null while it doesn't exist. */
  path: string | null;
  branch: string;
  changed: number;
  lastCommit: { subject: string; when: string } | null;
  features: Feature[];
  worktrees: Worktree[];
}

const lines = (s: string) => s.split("\n").filter(Boolean);

export async function readProject(id: string): Promise<Project | null> {
  const dir = projectDir(id);
  if (!dir) return null;
  const code = projectPath(id);
  const [branch, status, log] = code
    ? await Promise.all([git(code, "branch", "--show-current"), git(code, "status", "--porcelain"), git(code, "log", "-1", "--format=%s%x00%cr")])
    : ["", "", ""];
  const [subject, when] = log.trim().split("\0");
  const worktrees = await Promise.all(
    worktreeNames(id).map(async (wt) => {
      const p = join(dir, "worktrees", wt);
      const [b, st] = await Promise.all([git(p, "branch", "--show-current"), git(p, "status", "--porcelain")]);
      return { name: wt, path: p, branch: b.trim() || "(detached)", changed: lines(st).length };
    }),
  );
  const [first, part] = id.split("/");
  return {
    id,
    name: part ?? first!,
    workspace: part ? first!.replace(/-ws$/, "") : null,
    dir,
    path: code,
    branch: branch.trim() || (code ? "(detached)" : ""),
    changed: lines(status).length,
    lastCommit: subject ? { subject, when: when ?? "" } : null,
    features: listFeatures(dir),
    worktrees,
  };
}

export async function listProjects(): Promise<Project[]> {
  const all = await Promise.all(projectIds().map(readProject));
  return all.filter((p): p is Project => p !== null);
}

const MAX_DIFF = 400 * 1024;

/** Working-tree changes against HEAD plus the last commits — the "Changes" panel of a tab. */
export async function projectDiff(cwd: string) {
  const [stat, diff, untracked, recent] = await Promise.all([
    git(cwd, "diff", "HEAD", "--numstat"),
    git(cwd, "diff", "HEAD"),
    git(cwd, "ls-files", "--others", "--exclude-standard"),
    git(cwd, "log", "-8", "--format=%h%x00%s%x00%cr"),
  ]);
  return {
    files: lines(stat).map((l) => {
      const [add, del, file] = l.split("\t");
      return { file: file ?? "", add: Number(add) || 0, del: Number(del) || 0 };
    }),
    untracked: lines(untracked),
    diff: diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… (diff truncated)` : diff,
    commits: lines(recent).map((l) => {
      const [hash, subject, when] = l.split("\0");
      return { hash: hash ?? "", subject: subject ?? "", when: when ?? "" };
    }),
  };
}

export type Diff = Awaited<ReturnType<typeof projectDiff>>;
