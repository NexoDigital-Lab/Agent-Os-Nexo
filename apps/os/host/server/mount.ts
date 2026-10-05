// Mounts the active modules' server code in dependency order. A module whose server fails to load is skipped,
// with every module that depends on it, and the rest still start: one broken module (often a user's own) must
// never take the whole app down. Routes a module registered before failing stay mounted, so a register()
// should validate before it registers.
import { dependenciesOf, type DiscoveredModule } from "../../src/core/modules.ts";
import type { ModuleContext, ModuleServer } from "./module-api.ts";

export interface MountOptions {
  modules: DiscoveredModule[];
  /** Ids in load order; the failed ones are removed in place, so the web doesn't load them either. */
  active: string[];
  /** Filled with id → why it did not load. */
  failed: Map<string, string>;
  context: (mod: DiscoveredModule) => ModuleContext;
  load: (mod: DiscoveredModule, entry: string) => Promise<ModuleServer>;
  log?: (message: string, error: unknown) => void;
}

export async function mountModules(o: MountOptions): Promise<void> {
  for (const id of [...o.active]) {
    const mod = o.modules.find((m) => m.id === id);
    if (!mod) continue;
    const brokenDep = dependenciesOf(mod).find((d) => o.failed.has(d));
    if (brokenDep) {
      o.failed.set(id, `depends on "${brokenDep}", which failed to load`);
      continue;
    }
    const entry = mod.manifest.entry?.server;
    if (!entry) continue;
    try {
      const register = await o.load(mod, entry);
      if (typeof register !== "function") throw new Error(`${entry} has no default export register(ctx)`);
      await register(o.context(mod));
    } catch (error) {
      o.failed.set(id, error instanceof Error ? error.message : String(error));
      (o.log ?? ((m, e) => console.error(m, e)))(`[modules] ${id} failed to load and was skipped:`, error);
    }
  }
  for (const id of o.failed.keys()) {
    const i = o.active.indexOf(id);
    if (i >= 0) o.active.splice(i, 1);
  }
}
