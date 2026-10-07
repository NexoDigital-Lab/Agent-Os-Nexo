import { copyFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { basesDir } from "./paths.ts";
import { copyDir, ensureDir, isDir, listDir, readJson } from "./fsx.ts";
import { ownerOf } from "./owner.ts";

export interface FactoryItem {
  kind: "skills" | "conventions" | "agents" | "hooks" | "commands";
  name: string;
  /** Source inside nexo_bases/library. */
  src: string;
  /** Path relative to the library folder. */
  rel: string;
  /** File (relative to the item) that carries `owner`. */
  ownerFile: string;
  isDir: boolean;
}

const basesLibrary = join(basesDir, "library");

/** Which factory items an environment takes: every one, the core workflow only, or none. */
export const FACTORY_SETS = ["all", "core", "none"] as const;
export type FactorySet = (typeof FACTORY_SETS)[number];

export function isFactorySet(value: string): value is FactorySet {
  return (FACTORY_SETS as readonly string[]).includes(value);
}

/** Items (paths relative to library/) in the `core` set, from nexo_bases/library/sets.json. */
export function coreItems(): string[] {
  return readJson<{ core: string[] }>(join(basesLibrary, "sets.json")).core;
}

export function factoryItems(set: FactorySet = "all"): FactoryItem[] {
  if (set === "none") return [];
  const all = allFactoryItems();
  if (set === "all") return all;
  const core = new Set(coreItems());
  return all.filter((item) => core.has(item.rel));
}

function allFactoryItems(): FactoryItem[] {
  const items: FactoryItem[] = [];
  for (const kind of ["skills", "conventions"] as const) {
    for (const name of listDir(join(basesLibrary, kind))) {
      const src = join(basesLibrary, kind, name);
      if (!isDir(src)) continue;
      items.push({ kind, name, src, rel: `${kind}/${name}`, ownerFile: kind === "skills" ? "SKILL.md" : "README.md", isDir: true });
    }
  }
  const files: Array<[FactoryItem["kind"], string]> = [["agents", ".md"], ["hooks", ".json"], ["commands", ".json"]];
  for (const [kind, ext] of files) {
    for (const file of listDir(join(basesLibrary, kind))) {
      if (!file.endsWith(ext)) continue;
      const src = join(basesLibrary, kind, file);
      items.push({ kind, name: basename(file, ext), src, rel: `${kind}/${file}`, ownerFile: "", isDir: false });
    }
  }
  return items;
}

export interface FactoryReport {
  installed: string[];
  updated: string[];
  skipped: string[];
}

/**
 * Places factory items into <library>. New items are installed; existing items are replaced only
 * while their target still says `owner: nexo` (the update policy). Anything else is the user's.
 */
export function installFactory(libraryDir: string, set: FactorySet = "all"): FactoryReport {
  const report: FactoryReport = { installed: [], updated: [], skipped: [] };
  const items = factoryItems(set);
  for (const item of items) {
    const dst = join(libraryDir, item.rel);
    const ownerPath = item.isDir ? join(dst, item.ownerFile) : dst;
    if (!existsSync(dst)) {
      if (item.isDir) copyDir(item.src, dst);
      else {
        ensureDir(join(dst, ".."));
        copyFileSync(item.src, dst);
      }
      report.installed.push(item.rel);
    } else if (ownerOf(ownerPath) === "nexo") {
      if (item.isDir) copyDir(item.src, dst, true);
      else copyFileSync(item.src, dst);
      report.updated.push(item.rel);
    } else {
      report.skipped.push(item.rel);
    }
  }
  // Hook scripts are factory files referenced by factory hooks; keep them current.
  const scripts = join(basesLibrary, "hooks", "scripts");
  if (isDir(scripts) && items.some((item) => item.kind === "hooks")) copyDir(scripts, join(libraryDir, "hooks", "scripts"), true);
  return report;
}
