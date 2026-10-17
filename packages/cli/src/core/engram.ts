// Engram (third party, MIT, github.com/Gentleman-Programming/engram) as the agents' memory. Nexo installs one pinned
// release, verified against a SHA-256 it ships (nexo_bases/engram.json), and keeps its data in os/data/engram.
// Engram's own setup, hooks, HTTP server and cloud are never used: agents reach it only through `nexo memory mcp`.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { tarGzMember, zipMember } from "./archive.ts";
import { folder, TOOLS, type EnvironmentConfig } from "./config.ts";
import type { Connection } from "./connections.ts";
import { ensureDir, listDir, readJson, writeJson } from "./fsx.ts";
import { basesDir } from "./paths.ts";
import { findOnPath } from "./exec.ts";
import { readCliState } from "./selfupdate.ts";

export interface EngramAsset {
  file: string;
  sha256: string;
}

export interface EngramPin {
  name: string;
  version: string;
  repo: string;
  license: string;
  assets: Record<string, EngramAsset>;
}

/** Downloads a URL into memory; tests swap it so nothing touches the network. */
export type Fetcher = (url: string) => Promise<Buffer>;

export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

export const MEMORY_CONNECTION = "memory";

export function readPin(file = join(basesDir, "engram.json")): EngramPin {
  return readJson<EngramPin>(file);
}

/** The release asset for this machine, or an error naming the platforms Engram ships for. */
export function assetFor(pin: EngramPin, platform: string = process.platform, arch: string = process.arch): EngramAsset {
  const asset = pin.assets[`${platform}-${arch}`];
  if (!asset) throw new Error(`Engram ${pin.version} has no release for ${platform}-${arch} (available: ${Object.keys(pin.assets).join(", ")}).`);
  return asset;
}

export function binaryName(platform: string = process.platform): string {
  return platform === "win32" ? "engram.exe" : "engram";
}

export interface EngramPaths {
  /** os/runtime/engram: one folder per installed version. */
  base: string;
  /** os/data/engram: the SQLite database; kept by `remove`. */
  data: string;
}

export function engramPaths(root: string, config: EnvironmentConfig): EngramPaths {
  const os = folder(root, config, "os");
  return { base: join(os, "runtime", "engram"), data: join(os, "data", "engram") };
}

/** The read rule that keeps agents out of Engram's database, as a path relative to the environment. */
export function engramDenyRule(root: string, paths: EngramPaths): string {
  return `${relative(root, paths.data).replace(/\\/g, "/")}/**`;
}

export function binaryPath(paths: EngramPaths, version: string, platform: string = process.platform): string {
  return join(paths.base, version, binaryName(platform));
}

/** The installed versions (folders holding a binary), newest name last. */
export function installedVersions(paths: EngramPaths, platform: string = process.platform): string[] {
  return listDir(paths.base).filter((v) => !v.startsWith(".") && existsSync(join(paths.base, v, binaryName(platform))));
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Downloads the pinned release for this machine, refuses any bytes but the pinned ones, and writes the binary. */
export async function installEngram(
  paths: EngramPaths,
  pin: EngramPin,
  fetcher: Fetcher = defaultFetcher,
  platform: string = process.platform,
  arch: string = process.arch,
): Promise<{ binary: string; downloaded: boolean }> {
  const binary = binaryPath(paths, pin.version, platform);
  if (existsSync(binary)) return { binary, downloaded: false };
  const asset = assetFor(pin, platform, arch);
  const url = `https://github.com/${pin.repo}/releases/download/v${pin.version}/${asset.file}`;
  const archive = await fetcher(url);
  const got = sha256(archive);
  if (got !== asset.sha256) throw new Error(`${asset.file} does not match the pinned SHA-256 (got ${got}): refusing it.`);
  const bytes = asset.file.endsWith(".zip") ? zipMember(archive, binaryName(platform)) : tarGzMember(archive, binaryName(platform));
  if (!bytes) throw new Error(`${asset.file} has no ${binaryName(platform)}.`);
  const dir = join(paths.base, pin.version);
  const tmp = join(paths.base, `.${pin.version}.tmp-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  try {
    ensureDir(tmp);
    writeFileSync(join(tmp, binaryName(platform)), bytes);
    if (platform !== "win32") chmodSync(join(tmp, binaryName(platform)), 0o755);
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  ensureDir(paths.data);
  return { binary, downloaded: true };
}

/**
 * Removes every installed version except `keep`, as far as it can: on Windows an engram.exe still running for an open
 * AI session cannot be deleted, and that version is reported as kept instead of failing the whole command.
 */
export function pruneVersions(paths: EngramPaths, keep: string | null): { gone: string[]; busy: string[] } {
  const gone: string[] = [];
  const busy: string[] = [];
  for (const v of listDir(paths.base).filter((n) => n !== keep)) {
    try {
      rmSync(join(paths.base, v), { recursive: true, force: true });
      if (!v.startsWith(".")) gone.push(v);
    } catch {
      if (!v.startsWith(".")) busy.push(v);
    }
  }
  return { gone, busy };
}

/**
 * The `memory` connection every AI gets: Nexo's proxy, told which AI it serves and which environment it belongs to.
 * The environment travels as NEXO_ROOT in the connection's env, not on the command line: on Windows `nexo` is a .cmd
 * (npm shim or self-update launcher) that MCP clients can only start through `cmd /c`, and cmd would re-read a path
 * with `&` or `^` in it. The command line stays fixed words only.
 */
export function memoryConnection(root: string, platform: string = process.platform, nexo: string = nexoCommand(root, platform)): Connection {
  const run = [nexo, "memory", "mcp", "--ai", "{{ai}}"];
  return {
    name: MEMORY_CONNECTION,
    description: "Agent memory (Engram, third party, MIT) through Nexo's proxy: project-pinned, filtered, no prompts.",
    type: "mcp",
    command: platform === "win32" ? "cmd" : run[0]!,
    args: platform === "win32" ? ["/d", "/c", ...run] : run.slice(1),
    env: { NEXO_ROOT: root },
    tools: [...TOOLS],
    owner: "nexo",
  };
}

/** A `nexo` that is only there for one run or one folder: npx's cache, a project's node_modules/.bin, a relative dir. */
export const ephemeralNexo = (p: string): boolean => !isAbsolute(p) || /[\\/](_npx|node_modules[\\/]\.bin)[\\/]/.test(p);

/**
 * How an AI starts `nexo`. Outside Windows, the launcher's absolute path when it is known (the one self-update wrote,
 * else the first lasting `nexo` on this PATH — never one npx or `npm run` put there for a single run): an AI's PATH
 * is often not the user's (desktop launchers skip the shell profile, and a `node` shim may drop ~/.local/bin), so a
 * bare `nexo` would not be found. On Windows the bare name, since the path would go through cmd's command line.
 */
export function nexoCommand(root: string, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === "win32") return "nexo";
  let launcher: string | undefined;
  try {
    launcher = readCliState(root)?.launcher;
  } catch {
    launcher = undefined; // not an environment with a config yet
  }
  if (launcher && existsSync(launcher)) return launcher;
  return lastingNexoOnPath(env, platform) ?? "nexo";
}

/** The first `nexo` on PATH that is not temporary (npx's cache, node_modules/.bin, a relative dir), or null. */
export function lastingNexoOnPath(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string | null {
  const sep = platform === "win32" ? ";" : ":";
  for (const dir of String(env.PATH ?? env.Path ?? "").split(sep).filter((d) => isAbsolute(d))) {
    const found = findOnPath("nexo", { PATH: dir }, platform as NodeJS.Platform);
    if (found && !ephemeralNexo(found)) return found;
  }
  return null;
}

/** Whether the command a saved memory connection starts still reaches a lasting `nexo`: its absolute path still
 * there, or — for the bare name (and Windows' `cmd /c nexo`) — a lasting `nexo` on PATH to resolve it to. */
export function usableNexoCommand(command: unknown, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof command !== "string" || !command) return false;
  if (command === "nexo" || (platform === "win32" && command === "cmd")) return lastingNexoOnPath(env, platform) !== null;
  if (platform === "win32") return false;
  return !ephemeralNexo(command) && existsSync(command);
}

export const memoryConnectionFile = (libraryDir: string): string => join(libraryDir, "connections", `${MEMORY_CONNECTION}.json`);

export function writeMemoryConnection(libraryDir: string, root: string): void {
  writeJson(memoryConnectionFile(libraryDir), memoryConnection(root));
}

export function removeMemoryConnection(libraryDir: string): void {
  rmSync(memoryConnectionFile(libraryDir), { force: true });
}

/** Total bytes under a folder (the memory database and its WAL files). */
export function folderBytes(dir: string): number {
  let total = 0;
  for (const name of listDir(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? folderBytes(p) : s.size;
  }
  return total;
}
