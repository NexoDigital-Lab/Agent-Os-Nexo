import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isTree, mergeDirs, promptFrom, readChecked, template, validateTree } from "../server/store.ts";
import type { ArchNode } from "../server/types.ts";

const n = (id: string, name: string, parentId: string | null = null, rules = ""): ArchNode => ({ id, name, parentId, rules });
const bad = (nodes: ArchNode[], re: RegExp) => assert.throws(() => validateTree({ nodes }), (e: Error & { status?: number }) => e.status === 400 && re.test(e.message));

test("validateTree accepts a valid tree", () => {
  const t = validateTree({ nodes: [n("a", "src"), n("b", "api", "a", "# reglas"), n("c", "api")] });
  assert.equal(t.nodes.length, 3);
});

test("validateTree rejects cycles, including self-parenting", () => {
  bad([n("a", "x", "b"), n("b", "y", "a")], /Cycle/);
  bad([n("a", "x", "a")], /Cycle/);
});

test("validateTree rejects duplicate sibling names (case-insensitive) but allows them under different parents", () => {
  bad([n("a", "src"), n("b", "SRC")], /Repeated name/);
  assert.doesNotThrow(() => validateTree({ nodes: [n("a", "src"), n("b", "x"), n("c", "lib", "a"), n("d", "lib", "b")] }));
});

test("validateTree rejects bad names, unknown parents and repeated ids", () => {
  for (const name of ["", "a/b", "..", "a..b", " ", "x".repeat(81), "-"+"é"]) bad([n("a", name)], /Invalid folder name/);
  bad([n("a", "x", "nope")], /does not exist/);
  bad([n("a", "x"), n("a", "y")], /Repeated id/);
});

test("validateTree rejects more than 500 nodes", () => {
  const nodes = Array.from({ length: 501 }, (_, i) => n(`i${i}`, `d${i}`));
  bad(nodes, /Too many folders/);
  assert.doesNotThrow(() => validateTree({ nodes: nodes.slice(0, 500) }));
});

test("mergeDirs adds missing folders under the right parent and never removes or renames", () => {
  const before = { nodes: [n("a", "src", null, "mis reglas"), n("b", "Custom Plan")] };
  const merged = mergeDirs(before, [["src"], ["src", "api"], ["src", "api", "routes"], ["docs"]]);
  assert.deepEqual(merged.nodes.slice(0, 2), before.nodes);
  const byName = (name: string) => merged.nodes.find((x) => x.name === name)!;
  assert.equal(byName("api").parentId, "a");
  assert.equal(byName("routes").parentId, byName("api").id);
  assert.equal(byName("docs").parentId, null);
  assert.equal(merged.nodes.length, 5);
  assert.deepEqual(mergeDirs(merged, [["src", "api"], ["docs"]]).nodes, merged.nodes); // idempotent
  validateTree(merged);
});

test("mergeDirs respects the node cap", () => {
  const dirs = Array.from({ length: 600 }, (_, i) => [`d${i}`]);
  assert.equal(mergeDirs({ nodes: [] }, dirs).nodes.length, 500);
});

test("promptFrom is empty for the bare template and for no tree", () => {
  assert.equal(promptFrom(template("p"), { nodes: [] }), "");
  assert.equal(promptFrom("", { nodes: [] }), "");
});

test("promptFrom includes doc, folders and rules once there is content", () => {
  const out = promptFrom(template("p"), { nodes: [n("a", "src"), n("b", "api", "a", "Sin lógica de negocio")] });
  assert.match(out, /^Architecture the user defined/);
  assert.match(out, /- src\/\n {2}- api\/\n {6}Sin lógica de negocio/);
  assert.match(promptFrom("## Reglas\n- Nada de any", { nodes: [] }), /Nada de any/);
});

test("promptFrom caps the doc and the tree separately: a huge doc doesn't push the folders out", () => {
  const out = promptFrom("x ".repeat(50_000), { nodes: [n("a", "src"), n("b", "api", "a", "Sin lógica de negocio")] });
  assert.match(out, /Proposed folder structure/);
  assert.match(out, /- api\/\n {6}Sin lógica de negocio/);
  assert.ok(out.length < 12 * 1024 + 300);
  assert.match(out.split("Proposed folder structure")[0], /truncated\)/);
});

test("promptFrom caps a huge tree with its own marker", () => {
  const nodes = Array.from({ length: 300 }, (_, i) => n(`i${i}`, `carpeta${i}`, null, "regla ".repeat(100)));
  const out = promptFrom("## Reglas\n- algo", { nodes });
  assert.match(out, /algo/);
  assert.match(out, /truncated\)$/);
  assert.ok(out.length < 12 * 1024 + 300);
});

test("readChecked: corrupt or invalid tree.json gives the fallback and is backed up once", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "arch-"));
  const f = path.join(dir, "tree.json");
  writeFileSync(f, "{ not json");
  assert.deepEqual(readChecked(f, isTree, { nodes: [] }, true), { nodes: [] });
  assert.equal(readFileSync(`${f}.bak`, "utf8"), "{ not json");
  writeFileSync(f, JSON.stringify({ nodes: [{ id: "a", name: "../x", parentId: null, rules: "" }] }));
  assert.deepEqual(readChecked(f, isTree, { nodes: [] }, true), { nodes: [] });
  assert.equal(readFileSync(`${f}.bak`, "utf8"), "{ not json"); // first backup kept
  writeFileSync(f, JSON.stringify({ nodes: [n("a", "src")] }));
  assert.equal(readChecked(f, isTree, { nodes: [] }, true).nodes.length, 1);
  assert.deepEqual(readChecked(path.join(dir, "missing.json"), isTree, { nodes: [] }), { nodes: [] });
});
