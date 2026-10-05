import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Shape of modules/<name>/module.json (see schema/module.schema.json). */
export interface ModuleManifest {
  name: string;
  version: string;
  description: string;
  owner?: "nexo" | "user";
  dependsOn?: string[];
  core?: boolean;
  entry?: { server?: string; web?: string };
  nav?: { label: string; icon?: string; order?: number };
}

export interface DiscoveredModule {
  /** "editor" for a module, "editor/lsp" for a submodule. */
  id: string;
  dir: string;
  manifest: ModuleManifest;
  parent: string | null;
}

export interface Discovery {
  modules: DiscoveredModule[];
  problems: string[];
}

const NAME = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function validateManifest(manifest: Partial<ModuleManifest>, folderName: string): string[] {
  const problems: string[] = [];
  if (!manifest.name || !NAME.test(manifest.name)) problems.push(`invalid or missing name`);
  else if (manifest.name !== folderName) problems.push(`name "${manifest.name}" must match its folder "${folderName}"`);
  if (!manifest.version || !SEMVER.test(manifest.version)) problems.push(`invalid or missing version`);
  if (!manifest.description) problems.push(`missing description`);
  if (manifest.dependsOn && !Array.isArray(manifest.dependsOn)) problems.push(`dependsOn must be a list`);
  return problems;
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .sort();
}

/**
 * Finds every folder with a module.json under modules/ (and their submodules/, same shape), like
 * Odoo addons: dropping a folder with a manifest is all it takes for agent-os to see a module.
 */
export function discoverModules(modulesDir: string): Discovery {
  const modules: DiscoveredModule[] = [];
  const problems: string[] = [];
  const walk = (dir: string, parent: string | null) => {
    for (const folderName of subdirs(dir)) {
      const moduleDir = join(dir, folderName);
      const manifestPath = join(moduleDir, "module.json");
      if (!existsSync(manifestPath)) continue;
      const id = parent ? `${parent}/${folderName}` : folderName;
      let manifest: ModuleManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ModuleManifest;
      } catch (error) {
        problems.push(`${id}: module.json is not valid JSON (${(error as Error).message})`);
        continue;
      }
      const issues = validateManifest(manifest, folderName);
      if (issues.length) {
        problems.push(...issues.map((issue) => `${id}: ${issue}`));
        continue;
      }
      modules.push({ id, dir: moduleDir, manifest, parent });
      walk(join(moduleDir, "submodules"), id);
    }
  };
  walk(modulesDir, null);
  problems.push(...graphProblems(modules));
  return { modules, problems };
}

/** All dependencies of a module: declared ones plus its parent. */
export function dependenciesOf(mod: DiscoveredModule): string[] {
  const deps = [...(mod.manifest.dependsOn ?? [])];
  if (mod.parent) deps.push(mod.parent);
  return deps;
}

function graphProblems(modules: DiscoveredModule[]): string[] {
  const problems: string[] = [];
  const ids = new Set(modules.map((m) => m.id));
  for (const mod of modules) {
    for (const dep of mod.manifest.dependsOn ?? []) {
      if (!ids.has(dep)) problems.push(`${mod.id}: depends on unknown module "${dep}"`);
    }
  }
  try {
    loadOrder(modules);
  } catch (error) {
    problems.push((error as Error).message);
  }
  return problems;
}

/** Dependency-first order of the given modules. Throws on a cycle. */
export function loadOrder(modules: DiscoveredModule[]): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, trail: string[]) => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") throw new Error(`dependency cycle: ${[...trail, id].join(" → ")}`);
    const mod = byId.get(id);
    if (!mod) return;
    state.set(id, "visiting");
    for (const dep of dependenciesOf(mod)) visit(dep, [...trail, id]);
    state.set(id, "done");
    order.push(id);
  };
  for (const mod of modules) visit(mod.id, []);
  return order;
}

/** Enabled/disabled state, kept in os/data/modules.json so builds never reset it. */
export interface ModuleState {
  disabled: string[];
}

export function readState(file: string): ModuleState {
  if (!existsSync(file)) return { disabled: [] };
  const data = JSON.parse(readFileSync(file, "utf8")) as Partial<ModuleState>;
  return { disabled: Array.isArray(data.disabled) ? data.disabled : [] };
}

export function writeState(file: string, state: ModuleState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ disabled: [...new Set(state.disabled)].sort() }, null, 2)}\n`);
}

/** A module runs when it and everything it depends on are enabled. */
export function activeModules(modules: DiscoveredModule[], state: ModuleState): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const disabled = new Set(state.disabled);
  const memo = new Map<string, boolean>();
  const active = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false); // cycle guard: a module in a cycle is never active
    const mod = byId.get(id);
    const result = Boolean(mod) && !disabled.has(id) && dependenciesOf(mod as DiscoveredModule).every(active);
    memo.set(id, result);
    return result;
  };
  return loadOrder(modules).filter((id) => active(id));
}

/**
 * Enables or disables a module. Disabling is refused for core modules and for modules that other
 * active modules depend on (their dependents must be disabled first). Enabling also enables nothing
 * else: missing dependencies are reported instead.
 */
export function setEnabled(modules: DiscoveredModule[], state: ModuleState, id: string, enabled: boolean): ModuleState {
  const mod = modules.find((m) => m.id === id);
  if (!mod) throw new Error(`Unknown module "${id}".`);
  const disabled = new Set(state.disabled);
  if (enabled) {
    disabled.delete(id);
    const next = { disabled: [...disabled] };
    const blocked = dependenciesOf(mod).filter((dep) => !activeModules(modules, next).includes(dep));
    if (blocked.length) throw new Error(`Enable first: ${blocked.join(", ")}.`);
    return next;
  }
  if (mod.manifest.core) throw new Error(`"${id}" is a core module and cannot be disabled.`);
  const active = activeModules(modules, state);
  const dependents = modules
    .filter((m) => m.parent !== id && active.includes(m.id) && dependenciesOf(m).includes(id))
    .map((m) => m.id);
  if (dependents.length) throw new Error(`Disable first: ${dependents.join(", ")} (they depend on "${id}").`);
  disabled.add(id);
  return { disabled: [...disabled] };
}
