import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { basesDir } from "./paths.ts";
import { folder, type EnvironmentConfig } from "./config.ts";
import { copyTemplate, ensureDir, isDir, listDir } from "./fsx.ts";
import { generateAdapters } from "./adapters.ts";
import { loadPermissions, mergePermissions } from "./permissions.ts";

const NAME = /^[a-z0-9][a-z0-9._-]*$/;

export function repoName(url: string): string {
  return basename(url.replace(/\/+$/, "")).replace(/\.git$/, "").toLowerCase();
}

export function validateName(name: string): void {
  if (!NAME.test(name)) {
    throw new Error(`Invalid name "${name}": use lowercase letters, digits, ".", "_" or "-".`);
  }
}

export interface ProjectPaths {
  /** Folder holding AGENTS.md, code/, context/, secrets/. */
  dir: string;
  /** The -ws folder when the project is a part of a workspace. */
  workspace: string | null;
}

export function projectPaths(root: string, config: EnvironmentConfig, name: string, ws?: string): ProjectPaths {
  const projects = folder(root, config, "projects");
  if (!ws) return { dir: join(projects, name), workspace: null };
  const workspace = join(projects, `${ws}-ws`);
  return { dir: join(workspace, name), workspace };
}

function refreshAdapters(root: string, config: EnvironmentConfig, dir: string): void {
  const global = loadPermissions(join(folder(root, config, "library"), "permissions.json"));
  const local = loadPermissions(join(dir, "context", "permissions.json"));
  generateAdapters(root, config, dir, mergePermissions(global, local));
}

/** Creates the project skeleton; `fillCode` populates code/ (clone or git init). */
export function createProject(
  root: string,
  config: EnvironmentConfig,
  opts: { name: string; ws?: string },
  fillCode: (codeDir: string) => void,
): ProjectPaths {
  validateName(opts.name);
  if (opts.ws) validateName(opts.ws);
  const paths = projectPaths(root, config, opts.name, opts.ws);
  if (existsSync(paths.dir)) throw new Error(`${paths.dir} already exists.`);

  const template = join(basesDir, "project");
  const createdWorkspace = Boolean(paths.workspace && !existsSync(paths.workspace));
  if (paths.workspace && !existsSync(join(paths.workspace, "AGENTS.md"))) {
    const wsName = `${opts.ws}-ws`;
    copyTemplate(join(template), paths.workspace, { name: wsName });
    // A workspace holds shared context; code and secrets belong to its parts.
    rmSync(join(paths.workspace, "secrets"), { recursive: true, force: true });
    refreshAdapters(root, config, paths.workspace);
  }
  copyTemplate(template, paths.dir, { name: opts.ws ? `${opts.ws}-ws/${opts.name}` : opts.name });
  const code = join(paths.dir, "code");
  try {
    fillCode(code);
  } catch (error) {
    // Leave nothing half-made behind.
    rmSync(createdWorkspace && paths.workspace ? paths.workspace : paths.dir, { recursive: true, force: true });
    throw error;
  }
  ensureDir(code);
  refreshAdapters(root, config, paths.dir);
  return paths;
}

/** Every folder under projects/ that holds an AGENTS.md (projects, workspaces and parts). */
export function listProjectDirs(root: string, config: EnvironmentConfig): string[] {
  const out: string[] = [];
  const projects = folder(root, config, "projects");
  for (const name of listDir(projects)) {
    const dir = join(projects, name);
    if (!isDir(dir)) continue;
    if (existsSync(join(dir, "AGENTS.md"))) out.push(dir);
    if (name.endsWith("-ws")) {
      for (const part of listDir(dir)) {
        const partDir = join(dir, part);
        if (isDir(partDir) && existsSync(join(partDir, "AGENTS.md"))) out.push(partDir);
      }
    }
  }
  return out;
}

export { refreshAdapters };
