import { test } from "node:test";
import assert from "node:assert/strict";
import type { DiscoveredModule } from "../../src/core/modules.ts";
import type { ModuleContext, ModuleServer } from "./module-api.ts";
import { mountModules } from "./mount.ts";

const mod = (id: string, dependsOn: string[] = [], server = true): DiscoveredModule => ({
  id, dir: `/m/${id}`, parent: null,
  manifest: { name: id, version: "1.0.0", description: id, dependsOn, ...(server ? { entry: { server: "server/index.ts" } } : {}) },
});

test("a module that fails to load is skipped with its dependents; the others still mount", async () => {
  const modules = [mod("shell"), mod("broken", ["shell"]), mod("needs-broken", ["broken"], false), mod("fine", ["shell"])];
  const active = modules.map((m) => m.id);
  const failed = new Map<string, string>();
  const mounted: string[] = [];
  const servers: Record<string, ModuleServer> = {
    shell: (ctx) => void mounted.push(ctx.id),
    broken: () => { throw new Error("boom"); },
    fine: (ctx) => void mounted.push(ctx.id),
  };
  await mountModules({
    modules, active, failed,
    context: (m) => ({ id: m.id }) as ModuleContext,
    load: async (m) => servers[m.id]!,
    log: () => {},
  });
  assert.deepEqual(mounted, ["shell", "fine"]);
  assert.deepEqual(active, ["shell", "fine"], "the web won't load the failed ones");
  assert.equal(failed.get("broken"), "boom");
  assert.match(failed.get("needs-broken")!, /depends on "broken"/);
});

test("an entry without a default register export counts as a failure", async () => {
  const failed = new Map<string, string>();
  await mountModules({
    modules: [mod("odd")], active: ["odd"], failed,
    context: (m) => ({ id: m.id }) as ModuleContext,
    load: async () => undefined as unknown as ModuleServer,
    log: () => {},
  });
  assert.match(failed.get("odd")!, /no default export/);
});
