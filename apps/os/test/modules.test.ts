import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeModules, discoverModules, loadOrder, readState, setEnabled, writeState } from "../src/core/modules.ts";
import { buildToLoad, newerBuild } from "../src/core/versions.ts";

const root = mkdtempSync(join(tmpdir(), "agent-os-nexo-test-"));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function modulesDir(): string {
  const dir = join(root, `modules-${n++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function add(dir: string, rel: string, manifest: Record<string, unknown>): void {
  mkdirSync(join(dir, rel), { recursive: true });
  writeFileSync(join(dir, rel, "module.json"), JSON.stringify({ version: "1.0.0", description: "d", ...manifest }));
}

test("discovers modules and submodules from their manifests", () => {
  const dir = modulesDir();
  add(dir, "shell", { name: "shell", core: true });
  add(dir, "editor", { name: "editor", dependsOn: ["shell"] });
  add(dir, "editor/submodules/lsp", { name: "lsp" });
  mkdirSync(join(dir, "not-a-module"));
  const { modules, problems } = discoverModules(dir);
  assert.deepEqual(problems, []);
  assert.deepEqual(modules.map((m) => m.id), ["editor", "editor/lsp", "shell"]);
  assert.deepEqual(loadOrder(modules), ["shell", "editor", "editor/lsp"]);
});

test("reports bad manifests, unknown dependencies and cycles", () => {
  const dir = modulesDir();
  add(dir, "a", { name: "wrong" });
  add(dir, "b", { name: "b", dependsOn: ["ghost"] });
  add(dir, "c", { name: "c", dependsOn: ["d"] });
  add(dir, "d", { name: "d", dependsOn: ["c"] });
  const { problems } = discoverModules(dir);
  assert.ok(problems.some((p) => /must match its folder/.test(p)));
  assert.ok(problems.some((p) => /unknown module "ghost"/.test(p)));
  assert.ok(problems.some((p) => /dependency cycle/.test(p)));
});

test("enable/disable respects core modules and dependencies", () => {
  const dir = modulesDir();
  add(dir, "shell", { name: "shell", core: true });
  add(dir, "projects", { name: "projects", dependsOn: ["shell"] });
  add(dir, "sessions", { name: "sessions", dependsOn: ["shell", "projects"] });
  add(dir, "editor", { name: "editor", dependsOn: ["shell", "projects"] });
  add(dir, "editor/submodules/lsp", { name: "lsp" });
  const { modules } = discoverModules(dir);
  let state = { disabled: [] as string[] };

  // Dependencies first, then folder order.
  assert.deepEqual(activeModules(modules, state), ["shell", "projects", "editor", "editor/lsp", "sessions"]);
  assert.throws(() => setEnabled(modules, state, "shell", false), /core module/);
  assert.throws(() => setEnabled(modules, state, "projects", false), /Disable first: editor, sessions/);

  state = setEnabled(modules, state, "editor", false);
  assert.deepEqual(activeModules(modules, state), ["shell", "projects", "sessions"], "submodules go down with their parent");

  state = setEnabled(modules, state, "sessions", false);
  state = setEnabled(modules, state, "projects", false);
  assert.throws(() => setEnabled(modules, state, "editor", true), /Enable first: projects/);

  const file = join(root, "data", "modules.json");
  writeState(file, state);
  assert.deepEqual(readState(file).disabled, ["editor", "projects", "sessions"]);
});

test("versions: load the pin or the newest build, announce newer ones", () => {
  const osDir = join(root, "os");
  for (const v of ["1.0.0", "1.0.9", "1.1.0"]) mkdirSync(join(osDir, "versions", v), { recursive: true });
  assert.equal(buildToLoad(osDir), "1.1.0");
  assert.equal(newerBuild(osDir, "1.0.9"), "1.1.0");
  assert.equal(newerBuild(osDir, "1.1.0"), null);
  writeFileSync(join(osDir, "current"), "1.0.0\n");
  assert.equal(buildToLoad(osDir), "1.0.0");
});
