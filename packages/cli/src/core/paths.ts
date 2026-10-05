import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_FILE = "environment.config.json";

/** The package root (works from src/ and from dist/, both one level below it). */
export const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Factory content shipped with the package. */
export const basesDir = join(packageDir, "nexo_bases");

export function defaultRoot(): string {
  return join(homedir(), "environments");
}

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

/**
 * Finds the environment root: an explicit --root, then NEXO_ROOT, then the nearest parent of the
 * working directory that holds environment.config.json.
 */
export function findRoot(explicit?: string, from = process.cwd()): string {
  const candidate = explicit ?? process.env.NEXO_ROOT;
  if (candidate) {
    const root = resolve(expandHome(candidate));
    if (!existsSync(join(root, CONFIG_FILE))) {
      throw new Error(`No Nexo environment at ${root} (missing ${CONFIG_FILE}). Run \`nexo init\` first.`);
    }
    return root;
  }
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Not inside a Nexo environment. Run `nexo init`, or pass --root / set NEXO_ROOT.");
}
