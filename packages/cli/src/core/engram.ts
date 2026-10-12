// Engram (third party, MIT, github.com/Gentleman-Programming/engram) as the agents' memory. Nexo installs one pinned
// release, verified against a SHA-256 it ships (nexo_bases/engram.json), and keeps its data in os/data/engram.
// Engram's own setup, hooks, HTTP server and cloud are never used: agents reach it only through `nexo memory mcp`.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tarGzMember, zipMember } from "./archive.ts";
import { folder, TOOLS, type EnvironmentConfig } from "./config.ts";
import type { Connection } from "./connections.ts";
import { ensureDir, listDir, readJson, writeJson } from "./fsx.ts";
import { basesDir } from "./paths.ts";

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

/** Removes every installed version except `keep`. */
export function pruneVersions(paths: EngramPaths, keep: string | null): string[] {
  const gone = listDir(paths.base).filter((v) => v !== keep);
  for (const v of gone) rmSync(join(paths.base, v), { recursive: true, force: true });
  return gone.filter((v) => !v.startsWith("."));
}

/** The `memory` connection every AI gets: Nexo's proxy, told which AI it serves. */
export function memoryConnection(): Connection {
  return {
    name: MEMORY_CONNECTION,
    description: "Agent memory (Engram, third party, MIT) through Nexo's proxy: project-pinned, filtered, no prompts.",
    type: "mcp",
    command: "nexo",
    args: ["memory", "mcp", "--ai", "{{ai}}"],
    tools: [...TOOLS],
    owner: "nexo",
  };
}

export function writeMemoryConnection(libraryDir: string): void {
  writeJson(join(libraryDir, "connections", `${MEMORY_CONNECTION}.json`), memoryConnection());
}

export function removeMemoryConnection(libraryDir: string): void {
  rmSync(join(libraryDir, "connections", `${MEMORY_CONNECTION}.json`), { force: true });
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
