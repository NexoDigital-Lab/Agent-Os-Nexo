// Source Control for the editor: status, stage/unstage, discard, commit, push/pull/fetch, branches, stash,
// file diffs and merge conflicts — all plain git in the tab's working directory, with your global identity.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { httpError, run, trash } from "../../../../../host/server/http.ts";
import { safePath } from "../../../../projects/server/repo.ts";

// Never hang on a prompt: fail fast if a push/pull needs a password or an unknown host key.
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", GIT_EDITOR: "true" };

async function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  try {
    return (await run("git", args, { cwd, env: ENV, timeout, maxBuffer: 32 * 1024 * 1024 })).stdout;
  } catch (e: any) {
    throw httpError(e.killed ? 504 : 500, `git ${args[0]}: ${String(e.stderr || e.stdout || e.message).trim().split("\n").slice(-4).join("\n")}`);
  }
}
const tryGit = (cwd: string, args: string[]) => git(cwd, args).then((s) => s, () => null);

export type Change = { path: string; from?: string; code: string; label: string };
export type ScmStatus = {
  branch: string | null; // null = detached
  upstream: string | null;
  ahead: number;
  behind: number;
  hasCommits: boolean;
  merging: boolean;
  staged: Change[];
  unstaged: Change[];
  untracked: Change[];
  conflicts: Change[];
  stashes: { index: number; message: string }[];
};

const LABEL: Record<string, string> = { M: "modified", A: "new", D: "deleted", R: "renamed", C: "copied", T: "type changed", U: "conflict", "?": "untracked" };

export async function status(cwd: string): Promise<ScmStatus> {
  const raw = await git(cwd, ["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]);
  const parts = raw.split("\0");
  const head = parts.shift() ?? "";
  // "## main...origin/main [ahead 1, behind 2]" · "## No commits yet on main" · "## HEAD (no branch)"
  const hm = head.match(/^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/);
  const s: ScmStatus = {
    branch: head.includes("HEAD (no branch)") ? null : hm?.[1] ?? null,
    upstream: hm?.[2] ?? null,
    ahead: Number(hm?.[3]?.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(hm?.[3]?.match(/behind (\d+)/)?.[1] ?? 0),
    hasCommits: !/No commits yet|Initial commit/.test(head),
    merging: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
    stashes: [],
  };
  // In a worktree .git is a file, so ask git where MERGE_HEAD lives instead of assuming .git/.
  const mergeHead = await tryGit(cwd, ["rev-parse", "--git-path", "MERGE_HEAD"]);
  s.merging = !!mergeHead && existsSync(path.resolve(cwd, mergeHead.trim()));
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) continue;
    const x = e[0], y = e[1], p = e.slice(3);
    const from = x === "R" || x === "C" ? parts[++i] : undefined; // renames carry the old path as the next entry
    if (x === "?") s.untracked.push({ path: p, code: "?", label: LABEL["?"] });
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) s.conflicts.push({ path: p, code: "U", label: LABEL.U });
    else {
      if (x !== " ") s.staged.push({ path: p, from, code: x, label: LABEL[x] ?? x });
      if (y !== " ") s.unstaged.push({ path: p, code: y, label: LABEL[y] ?? y });
    }
  }
  const st = await tryGit(cwd, ["stash", "list", "--format=%gs"]);
  s.stashes = (st ?? "").split("\n").filter(Boolean).map((message, index) => ({ index, message }));
  return s;
}

const paths = (cwd: string, list: unknown): string[] => {
  const arr = (Array.isArray(list) ? list : []).map(String);
  if (!arr.length) throw httpError(400, "No files");
  for (const p of arr) safePath(cwd, p); // stays inside the repo
  return arr;
};

export async function stage(cwd: string, list: unknown) {
  if (list === "all") await git(cwd, ["add", "-A"]);
  else await git(cwd, ["add", "--", ...paths(cwd, list)]);
  return status(cwd);
}

export async function unstage(cwd: string, list: unknown) {
  const s = await status(cwd);
  const files = list === "all" ? s.staged.map((c) => c.path) : paths(cwd, list);
  if (!files.length) return s;
  // Before the first commit there's no HEAD to restore from.
  if (s.hasCommits) await git(cwd, ["restore", "--staged", "--", ...files]);
  else await git(cwd, ["rm", "--cached", "-q", "-r", "--", ...files]);
  return status(cwd);
}

/** Tracked files go back to the last commit; untracked ones go to the trash (recoverable). */
export async function discard(cwd: string, list: unknown) {
  const files = paths(cwd, list);
  const s = await status(cwd);
  const untracked = files.filter((f) => s.untracked.some((u) => u.path === f));
  const tracked = files.filter((f) => !untracked.includes(f));
  if (tracked.length) await git(cwd, ["restore", "--", ...tracked]);
  for (const f of untracked) {
    await trash(safePath(cwd, f), f);
  }
  return status(cwd);
}

export async function commit(cwd: string, body: { message?: string; amend?: boolean; all?: boolean }) {
  const msg = String(body.message ?? "").trim();
  if (!msg && !body.amend) throw httpError(400, "Write a commit message");
  if (body.all) await git(cwd, ["add", "-A"]);
  const args = ["commit", "-q"];
  if (body.amend) args.push("--amend", ...(msg ? ["-m", msg] : ["--no-edit"]));
  else args.push("-m", msg);
  await git(cwd, args);
  return status(cwd);
}

export async function sync(cwd: string, op: "push" | "pull" | "fetch") {
  const s = await status(cwd);
  if (op === "fetch") await git(cwd, ["fetch", "--all", "--prune"], 120_000);
  else if (op === "pull") await git(cwd, ["pull", "--no-rebase"], 120_000);
  else if (!s.upstream) await git(cwd, ["push", "-u", "origin", "HEAD"], 120_000);
  else await git(cwd, ["push"], 120_000);
  return status(cwd);
}

export async function branches(cwd: string) {
  const out = await git(cwd, ["branch", "-a", "--format=%(refname:short)\t%(HEAD)\t%(committerdate:relative)"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [name, head, when] = l.split("\t");
      return { name, current: head === "*", remote: name.startsWith("origin/") || name.includes("/"), when };
    })
    .filter((b) => !b.name.endsWith("/HEAD") && b.name !== "origin");
}

export async function checkout(cwd: string, body: { name?: string; create?: boolean }) {
  const name = String(body.name ?? "").trim();
  if (!/^[\w./-]+$/.test(name) || name.startsWith("-")) throw httpError(400, "Invalid branch name");
  if (body.create) await git(cwd, ["switch", "-c", name]);
  else if (name.startsWith("origin/")) await git(cwd, ["switch", "--track", name]);
  else await git(cwd, ["switch", name]);
  return status(cwd);
}

export async function stash(cwd: string, body: { op?: string; index?: number; message?: string }) {
  const ref = `stash@{${Number(body.index ?? 0)}}`;
  if (body.op === "push") await git(cwd, ["stash", "push", "--include-untracked", ...(body.message ? ["-m", String(body.message)] : [])]);
  else if (body.op === "pop") await git(cwd, ["stash", "pop", ref]);
  else if (body.op === "apply") await git(cwd, ["stash", "apply", ref]);
  else if (body.op === "drop") await git(cwd, ["stash", "drop", ref]);
  else throw httpError(400, "Unknown stash operation");
  return status(cwd);
}

/** Both sides for Monaco's diff editor. staged: HEAD ↔ index · else: index ↔ working tree. */
export async function fileDiff(cwd: string, file: string, staged: boolean) {
  const abs = safePath(cwd, file);
  const show = (spec: string) => tryGit(cwd, ["show", spec]).then((s) => s ?? "");
  const original = staged ? await show(`HEAD:${file}`) : (await tryGit(cwd, ["show", `:${file}`])) ?? (await show(`HEAD:${file}`));
  const modified = staged ? await show(`:${file}`) : existsSync(abs) ? readFileSync(abs, "utf8") : "";
  return { original, modified };
}

export async function resolveConflict(cwd: string, body: { path?: string; side?: "ours" | "theirs" | "manual" }) {
  const [file] = paths(cwd, [body.path]);
  if (body.side === "ours" || body.side === "theirs") await git(cwd, ["checkout", `--${body.side}`, "--", file]);
  else if (/^(<{7}|>{7})/m.test(readFileSync(safePath(cwd, file), "utf8"))) throw httpError(409, `${file} still has <<<<<<< / >>>>>>> markers`);
  await git(cwd, ["add", "--", file]);
  return status(cwd);
}

export async function abortMerge(cwd: string) {
  await git(cwd, ["merge", "--abort"]);
  return status(cwd);
}

export type Branch = Awaited<ReturnType<typeof branches>>[number];
