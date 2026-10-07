import { existsSync } from "node:fs";
import { join } from "node:path";
import { listDir, readText, writeText } from "./fsx.ts";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: string): [number, number, number] | null {
  const m = SEMVER.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = parse(a) ?? [0, 0, 0];
  const pb = parse(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const diff = (pa.at(i) ?? 0) - (pb.at(i) ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Next personal agent-os-nexo version: starts at 1.0.0, patch +1 per approved build, and after x.y.9
 * comes x.(y+1).0. The major version is reserved for Nexo releases and never changes here.
 */
export function nextVersion(latest: string | null): string {
  const parsed = latest ? parse(latest) : null;
  if (!parsed) return "1.0.0";
  const [major, minor, patch] = parsed;
  return patch >= 9 ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

export function listVersions(osDir: string): string[] {
  return listDir(join(osDir, "versions")).filter((v) => SEMVER.test(v)).sort(compareVersions);
}

/** The version agent-os-nexo loads: the pinned one if `os/current` exists, otherwise the newest. */
export function activeVersion(osDir: string): string | null {
  const pin = join(osDir, "current");
  if (existsSync(pin)) {
    const pinned = readText(pin).trim();
    if (pinned) return pinned;
  }
  return listVersions(osDir).at(-1) ?? null;
}

export function pinVersion(osDir: string, version: string | null): void {
  writeText(join(osDir, "current"), version ?? "");
}
