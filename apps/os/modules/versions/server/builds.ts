// The builds in os/versions/ and which one loads on the next start (os/current pins one; otherwise the newest).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildToLoad, listBuilds } from "../../../src/core/versions.ts";

export interface Build {
  version: string;
  /** ISO time from the build's build.json, when it has one. */
  builtAt: string | null;
  /** What changed, as written by whoever built it. */
  notes: string | null;
}

export interface BuildsState {
  running: string;
  builds: Build[];
  pinned: string | null;
  /** What the next start loads. */
  next: string | null;
}

function readBuild(osDir: string, version: string): Build {
  try {
    const meta = JSON.parse(readFileSync(join(osDir, "versions", version, "build.json"), "utf8")) as { builtAt?: string; notes?: string };
    return { version, builtAt: meta.builtAt ?? null, notes: meta.notes ?? null };
  } catch {
    return { version, builtAt: null, notes: null };
  }
}

export function buildsState(osDir: string, running: string): BuildsState {
  const pinFile = join(osDir, "current");
  const pinned = existsSync(pinFile) ? readFileSync(pinFile, "utf8").trim() || null : null;
  return {
    running,
    builds: listBuilds(osDir).map((v) => readBuild(osDir, v)).reverse(),
    pinned,
    next: buildToLoad(osDir),
  };
}

/** Pins a build for the next start, or (null) goes back to "the newest". Never restarts anything. */
export function pin(osDir: string, version: string | null): void {
  const pinFile = join(osDir, "current");
  if (version === null) {
    rmSync(pinFile, { force: true });
    return;
  }
  if (!listBuilds(osDir).includes(version)) throw new Error(`No build ${version} in os/versions/.`);
  writeFileSync(pinFile, `${version}\n`);
}
