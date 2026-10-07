// The user's agent-os-nexo is a git repository (os/source): branch `base` holds Nexo's releases exactly as shipped,
// `main` holds the user's version (base + their changes, one commit per build). Updating puts the new release on
// `base` and merges it into `main`, so personal changes survive and real conflicts are shown, never overwritten.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, writeText } from "./fsx.ts";
import { copySource } from "./osruntime.ts";

const IGNORE = "# Generated or linked by nexo os: never part of the user's version.\nnode_modules\ndist\n*.building/\n";
const AUTHOR = ["-c", "user.name=nexo", "-c", "user.email=nexo@localhost"];

function git(cwd: string, args: string[], author = false): string {
  return execFileSync("git", [...(author ? AUTHOR : []), ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const versionOf = (dir: string) => readJson<{ version?: string }>(join(dir, "package.json")).version ?? "unknown";
export const isVersioned = (source: string) => existsSync(join(source, ".git"));

/** Turns a fresh os/source into the repository: `base` = this release, `main` = the user's branch on top of it. */
export function initSourceRepo(source: string): void {
  if (isVersioned(source)) return;
  writeText(join(source, ".gitignore"), IGNORE);
  git(source, ["init", "-q", "-b", "base"]);
  git(source, ["add", "-A"]);
  git(source, ["commit", "-q", "-m", `agent-os-nexo ${versionOf(source)} (Nexo release)`], true);
  git(source, ["tag", `release-${versionOf(source)}`]);
  git(source, ["checkout", "-q", "-b", "main"]);
}

/** Commits whatever the user (or an agent) changed in os/source; returns false when there was nothing. */
export function commitChanges(source: string, message: string): boolean {
  if (!isVersioned(source)) return false;
  git(source, ["add", "-A"]);
  if (!git(source, ["status", "--porcelain"])) return false;
  git(source, ["commit", "-q", "-m", message], true);
  return true;
}

export function tagBuild(source: string, version: string): void {
  if (isVersioned(source)) git(source, ["tag", "-f", `v${version}`]);
}

/** Files left with conflicts by a merge in progress. */
export const conflicts = (source: string) => git(source, ["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
export const mergeInProgress = (source: string) => existsSync(join(source, ".git", "MERGE_HEAD"));

export interface UpdateResult {
  from: string;
  to: string;
  /** Empty when the merge finished cleanly. */
  conflicts: string[];
}

/**
 * Puts the release in `release` (a folder with the new package) on `base` and merges it into `main`. The user's
 * pending changes are committed first. On conflicts the merge stays in progress for `continueUpdate`/`abortUpdate`.
 */
export function updateSource(source: string, release: string): UpdateResult {
  if (!isVersioned(source)) throw new Error("os/source is not versioned (installed before updates existed). Install again to start the history.");
  if (mergeInProgress(source)) throw new Error("An update is already waiting for its conflicts: resolve them, then `nexo os update --continue` (or --abort).");
  const from = versionOf(source);
  const to = versionOf(release);
  commitChanges(source, "Local changes before updating");
  // Replace base's content with the release, in a worktree so main's files stay untouched until the merge.
  const work = mkdtempSync(join(tmpdir(), "nexo-base-"));
  try {
    git(source, ["worktree", "add", "-q", work, "base"]);
    for (const entry of readdirSync(work)) if (entry !== ".git" && entry !== ".gitignore") rmSync(join(work, entry), { recursive: true, force: true });
    const staged = mkdtempSync(join(tmpdir(), "nexo-release-"));
    copySource(release, join(staged, "s"));
    cpSync(join(staged, "s"), work, { recursive: true });
    rmSync(staged, { recursive: true, force: true });
    git(work, ["add", "-A"]);
    if (git(work, ["status", "--porcelain"])) {
      git(work, ["commit", "-q", "-m", `agent-os-nexo ${to} (Nexo release)`], true);
      git(work, ["tag", "-f", `release-${to}`]);
    }
  } finally {
    try {
      git(source, ["worktree", "remove", "--force", work]);
    } catch {
      rmSync(work, { recursive: true, force: true });
    }
  }
  try {
    git(source, ["merge", "--no-edit", "-m", `Update to agent-os-nexo ${to}`, "base"], true);
  } catch {
    const left = conflicts(source);
    if (!left.length) throw new Error("The merge failed without conflicts; see `git -C os/source status`.");
    return { from, to, conflicts: left };
  }
  return { from, to, conflicts: [] };
}

/** Finishes an update once its conflicts are resolved (no conflict markers left). */
export function continueUpdate(source: string): void {
  if (!mergeInProgress(source)) throw new Error("No update is waiting.");
  git(source, ["add", "-A"]);
  const left = conflictMarkers(source);
  if (left.length) throw new Error(`Conflict markers are still in: ${left.join(", ")}`);
  git(source, ["commit", "-q", "--no-edit"], true);
}

/** Gives up an update: main goes back to how it was before it. */
export function abortUpdate(source: string): void {
  if (!mergeInProgress(source)) throw new Error("No update is waiting.");
  git(source, ["merge", "--abort"]);
}

function conflictMarkers(source: string): string[] {
  try {
    return git(source, ["grep", "--cached", "-l", "-E", "^(<<<<<<<|>>>>>>>)( |$)"]).split("\n").filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}
