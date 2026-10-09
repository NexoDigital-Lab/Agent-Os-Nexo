// nexo self-update: the environment's `nexo` runs a copy of the CLI taken from one commit of a Nexo checkout
// (main or a tag), never the checkout itself — work in progress there never reaches the environment.
// The copy is read from git objects (`git cat-file --batch`), so uncommitted changes and other branches are never copied.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ensureDir, listDir, readJson, writeJson, writeText } from "./fsx.ts";

/** The CLI's folder inside a Nexo checkout. */
export const CLI_PATH = "packages/cli";
const PACKAGE = "@nexodigital/nexo";

/** Written into every launcher Nexo creates: a launcher without it belongs to someone else (npm, the user). */
export const LAUNCHER_MARK = "nexo self-update launcher";

/** Installed copies kept besides the active one, so a bad update can be undone by hand. */
const KEEP = 2;

/** Runs git in `cwd`; returns stdout as a Buffer, throws with git's message on failure. */
export type Git = (args: string[], cwd: string, input?: string) => Buffer;

export const defaultGit: Git = (args, cwd, input) => {
  const r = spawnSync("git", args, { cwd, input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error) throw new Error(`git could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`\`git ${args.join(" ")}\` failed: ${r.stderr.toString().trim()}`);
  return r.stdout;
};

/** What the last self-update installed, in `.state/nexo/cli.json`. */
export interface CliState {
  source: string;
  ref: string;
  commit: string;
  version: string;
  dir: string;
  launcher: string;
  installedAt: string;
}

export const stateFile = (root: string): string => join(root, ".state", "nexo", "cli.json");

export function readCliState(root: string): CliState | null {
  try {
    return readJson<CliState>(stateFile(root));
  } catch {
    return null;
  }
}

/** Where the launcher goes when none is given: ~/.local/bin/nexo (nexo.cmd on Windows). */
export function defaultLauncher(platform: NodeJS.Platform = process.platform, home = homedir()): string {
  return join(home, ".local", "bin", platform === "win32" ? "nexo.cmd" : "nexo");
}

/** The launcher's text: it runs the installed copy with the `node` on PATH (so a Node upgrade does not break it). */
export function launcherText(entry: string, platform: NodeJS.Platform = process.platform, node = "node"): string {
  if (platform === "win32") return `@echo off\r\nrem ${LAUNCHER_MARK}: runs the CLI copy in ${entry}\r\n${node} "${entry}" %*\r\n`;
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\n# ${LAUNCHER_MARK}: runs the CLI copy installed from one commit (os/runtime/cli/<version>-<commit>),\n# never the checkout — re-run \`nexo self-update\` to move it.\nexec ${q(node)} ${q(entry)} "$@"\n`;
}

/** True when `path` is free to write: missing, or a launcher Nexo wrote (by its mark or the manual one before it). */
export function ownLauncher(path: string): boolean {
  if (!existsSync(path)) return true;
  if (!statSync(path).isFile() || statSync(path).size > 4096) return false;
  const text = readFileSync(path, "utf8");
  return text.includes(LAUNCHER_MARK) || text.includes("os/runtime/cli/");
}

/** Resolves `ref` to a commit and checks it carries the Nexo CLI. */
export function resolveCommit(git: Git, source: string, ref: string): { commit: string; version: string } {
  if (!/^[\w./-]+$/.test(ref) || ref.startsWith("-")) throw new Error(`"${ref}" is not a branch, tag or commit name.`);
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], source).toString().trim();
  let pkg: { name?: string; version?: string };
  try {
    pkg = JSON.parse(git(["show", `${commit}:${CLI_PATH}/package.json`], source).toString()) as typeof pkg;
  } catch {
    throw new Error(`${ref} (${commit.slice(0, 7)}) has no ${CLI_PATH}/package.json: not a Nexo checkout.`);
  }
  if (pkg.name !== PACKAGE || !pkg.version) throw new Error(`${ref} carries ${pkg.name ?? "an unnamed package"}, not ${PACKAGE}.`);
  return { commit, version: pkg.version };
}

/** Writes every file of `CLI_PATH` at `commit` under `dest` (one `git cat-file --batch` for all of them). */
export function exportTree(git: Git, source: string, commit: string, dest: string): number {
  const listing = git(["ls-tree", "-r", "-z", "--full-tree", commit, "--", CLI_PATH], source).toString();
  const entries = listing.split("\0").filter(Boolean).map((line) => {
    const [meta, path] = line.split("\t") as [string, string];
    const [mode, type, oid] = meta.split(" ") as [string, string, string];
    return { mode, type, oid, path };
  }).filter((e) => e.type === "blob" && e.mode !== "120000"); // symlinks are never copied
  if (!entries.length) throw new Error(`${CLI_PATH} is empty at ${commit.slice(0, 7)}.`);
  const out = git(["cat-file", "--batch"], source, entries.map((e) => e.oid).join("\n") + "\n");
  let at = 0;
  for (const e of entries) {
    const nl = out.indexOf(0x0a, at);
    const [oid, , size] = out.subarray(at, nl).toString().split(" ");
    if (oid !== e.oid) throw new Error(`git returned ${oid} for ${e.path}.`);
    const body = out.subarray(nl + 1, nl + 1 + Number(size));
    at = nl + 1 + Number(size) + 1;
    const rel = e.path.slice(CLI_PATH.length + 1);
    if (!rel || rel.split("/").some((p) => p === ".." || p === "")) throw new Error(`Refusing the path ${e.path}.`);
    const file = join(dest, ...rel.split("/"));
    ensureDir(dirname(file));
    writeFileSync(file, body); // byte for byte (writeText would add a newline)
    if (e.mode === "100755") chmodSync(file, 0o755);
  }
  return entries.length;
}

export interface SelfUpdateOptions {
  root: string;
  source: string;
  ref: string;
  launcher: string;
  git?: Git;
  /** Runs the new copy's `--version`; tests swap it. */
  probe?: (entry: string) => string;
  platform?: NodeJS.Platform;
}

const defaultProbe = (entry: string): string => {
  const r = spawnSync(process.execPath, [entry, "--version"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (r.status !== 0) throw new Error(`The new copy does not start: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
};

/** Installs the CLI at `ref` of `source` into os/runtime/cli/<version>-<commit> and points the launcher at it. */
export function selfUpdate(opts: SelfUpdateOptions): { state: CliState; changed: boolean; files: number } {
  const git = opts.git ?? defaultGit;
  const source = resolve(opts.source);
  const { commit, version } = resolveCommit(git, source, opts.ref);
  const base = join(opts.root, "os", "runtime", "cli");
  const name = `${version}-${commit.slice(0, 7)}`;
  const dir = join(base, name);
  const entry = join(dir, "src", "bin.ts");
  if (!ownLauncher(opts.launcher)) {
    throw new Error(`${opts.launcher} exists and is not a launcher Nexo wrote (an npm install?). Pass --bin <path> for another one, or remove it.`);
  }

  let files = 0;
  const previous = readCliState(opts.root);
  if (!existsSync(entry)) {
    const tmp = join(base, `.${name}.tmp-${process.pid}`);
    rmSync(tmp, { recursive: true, force: true });
    try {
      files = exportTree(git, source, commit, tmp);
      const got = (opts.probe ?? defaultProbe)(join(tmp, "src", "bin.ts"));
      if (got !== version) throw new Error(`The new copy reports version "${got}", expected ${version}.`);
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  writeText(opts.launcher, launcherText(entry, opts.platform));
  if ((opts.platform ?? process.platform) !== "win32") chmodSync(opts.launcher, 0o755);
  const state: CliState = { source, ref: opts.ref, commit, version, dir, launcher: opts.launcher, installedAt: new Date().toISOString() };
  writeJson(stateFile(opts.root), state);
  prune(base, dir);
  return { state, changed: previous?.commit !== commit, files };
}

/** Removes old copies, keeping the active one and the KEEP most recent others. */
function prune(base: string, active: string): void {
  const others = listDir(base)
    .filter((n) => !n.startsWith(".") && join(base, n) !== active)
    .map((n) => ({ n, t: statSync(join(base, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { n } of others.slice(KEEP)) rmSync(join(base, n), { recursive: true, force: true });
}
