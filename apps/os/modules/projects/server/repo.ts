// Safe access to a project's repository: paths never leave it (not even through a symlink) and never touch .git.
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { httpError, run } from "../../../host/server/http.ts";

export const inside = (root: string, abs: string) => abs === root || abs.startsWith(root + path.sep);

/** The real path of `abs`, or of its nearest existing ancestor (for paths about to be created). */
export function realOrAncestor(abs: string): string {
  let p = abs;
  while (!existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
  return realpathSync(p);
}

/** Resolves a repo-relative path inside `root`, or throws. */
export function safePath(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (!inside(root, abs)) throw httpError(400, "Path outside the project");
  if (path.relative(root, abs).split(path.sep).includes(".git")) throw httpError(400, ".git is not edited from here");
  if (!inside(realpathSync(root), realOrAncestor(abs))) throw httpError(400, "Path outside the project (symlink)");
  return abs;
}

/** Tracked and untracked (not ignored) files of a repository, relative to it. */
export const repoFiles = (root: string) =>
  run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 32 * 1024 * 1024 }).then(
    (r) => r.stdout.split("\n").filter(Boolean),
    () => [] as string[],
  );
