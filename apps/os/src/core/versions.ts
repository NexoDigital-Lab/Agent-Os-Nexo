import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a)?.slice(1).map(Number) ?? [0, 0, 0];
  const pb = SEMVER.exec(b)?.slice(1).map(Number) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const diff = (pa.at(i) ?? 0) - (pb.at(i) ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Builds in os/versions/, oldest first. */
export function listBuilds(osDir: string): string[] {
  const dir = join(osDir, "versions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((v) => SEMVER.test(v)).sort(compareVersions);
}

/** The build agent-os starts with: the pin in os/current, or the newest build. */
export function buildToLoad(osDir: string): string | null {
  const pin = join(osDir, "current");
  if (existsSync(pin)) {
    const pinned = readFileSync(pin, "utf8").trim();
    if (pinned) return pinned;
  }
  return listBuilds(osDir).at(-1) ?? null;
}

/**
 * The newer build to announce while running ("New version detected — restart to load it"), or null.
 * agent-os never restarts itself; this only drives the notification.
 */
export function newerBuild(osDir: string, running: string): string | null {
  const latest = listBuilds(osDir).at(-1);
  return latest && compareVersions(latest, running) > 0 ? latest : null;
}
