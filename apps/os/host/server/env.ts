// Where things live: the Nexo environment agent-os runs in (folders from environment.config.json).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CONFIG_FILE = "environment.config.json";

export interface Env {
  /** The environment root (holds environment.config.json). */
  root: string;
  library: string;
  projects: string;
  blueprints: string;
  /** <root>/os: source/, versions/, runtime/, data/. */
  os: string;
  /** <root>/os/data: what agent-os keeps for the user; builds never touch it. */
  data: string;
  /** <root>/.state/os: generated, safe to delete (logs, caches, search index, shims). */
  state: string;
}

interface Folders {
  library: string;
  blueprints: string;
  projects: string;
  os: string;
  state: string;
}

/** The nearest folder at or above `start` that holds environment.config.json. */
export function findEnvRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function envAt(root: string): Env {
  const config = JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")) as { folders?: Partial<Folders> };
  const f: Folders = { library: "library", blueprints: "blueprints", projects: "projects", os: "os", state: ".state", ...config.folders };
  const os = join(root, f.os);
  return {
    root,
    library: join(root, f.library),
    projects: join(root, f.projects),
    blueprints: join(root, f.blueprints),
    os,
    data: join(os, "data"),
    state: join(root, f.state, "os"),
  };
}

/**
 * The environment to serve: NEXO_ROOT when set, otherwise the one this copy of agent-os lives in
 * (a build sits at <root>/os/versions/<x.y.z>, the editable copy at <root>/os/source).
 */
export function loadEnv(appDir: string, override = process.env.NEXO_ROOT): Env {
  const root = override ? resolve(override) : findEnvRoot(appDir);
  if (!root || !existsSync(join(root, CONFIG_FILE))) {
    throw new Error(`No Nexo environment found${override ? ` at ${override}` : ` above ${appDir}`}. Set NEXO_ROOT or run \`nexo init\`.`);
  }
  return envAt(root);
}
