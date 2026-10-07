// The user's dictionary: the file format, lookup by name or alias, updates that keep what was there, and the
// `nexo dict` command with its effect on library/index.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { dict } from "../src/commands/dict.ts";
import { findTerm, listTerms, removeTerm, saveTerm, slugify } from "../src/core/dictionary.ts";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

test("slugify: lowercase, no accents, dashes", () => {
  assert.equal(slugify("Gate 2 / Compuerta"), "gate-2-compuerta");
  assert.equal(slugify("Ñandú Árbol"), "nandu-arbol");
  assert.equal(slugify("../../etc"), "etc", "a term can never become a path");
  assert.equal(slugify("!!!"), "");
});

test("a new term is written with its frontmatter and read back", () => {
  const lib = tempDir();
  const t = saveTerm(lib, { term: "Cliente activo", summary: "Compró en los últimos 90 días", aliases: ["activo", "cliente vigente"], body: "Se cuenta por cuenta, no por usuario." }, "2026-10-07");
  assert.equal(t.created, true);
  assert.equal(t.path, join("dictionary", "cliente-activo.md"));
  const text = readFileSync(join(lib, t.path), "utf8");
  assert.match(text, /^---\nterm: Cliente activo\naliases: \[activo, cliente vigente\]\nsummary: Compró en los últimos 90 días\nowner: user\nupdated: 2026-10-07\n---\n/);
  const [back] = listTerms(lib);
  assert.deepEqual({ ...back, path: undefined }, { term: "Cliente activo", aliases: ["activo", "cliente vigente"], summary: "Compró en los últimos 90 días", owner: "user", updated: "2026-10-07", path: undefined, body: "Se cuenta por cuenta, no por usuario." });
});

test("lookup ignores case and accents and finds aliases; saving under an alias updates the same file", () => {
  const lib = tempDir();
  saveTerm(lib, { term: "Cliente activo", summary: "90 días", aliases: ["activo"] }, "2026-10-01");
  assert.equal(findTerm(lib, "CLIENTE ACTIVO")?.term, "Cliente activo");
  assert.equal(findTerm(lib, "Activó")?.term, "Cliente activo");
  const updated = saveTerm(lib, { term: "activo", summary: "60 días", aliases: ["vigente"] }, "2026-10-07");
  assert.equal(updated.created, false);
  assert.equal(updated.term, "Cliente activo", "the main name stays");
  assert.deepEqual(updated.aliases, ["activo", "vigente"]);
  assert.equal(updated.summary, "60 días");
  assert.equal(listTerms(lib).length, 1);
});

test("an update keeps what it was not given; a new term needs a summary; bad input is refused", () => {
  const lib = tempDir();
  saveTerm(lib, { term: "MER", summary: "Marketing efficiency ratio", body: "Ventas / gasto en ads." });
  const t = saveTerm(lib, { term: "mer", aliases: ["eficiencia"] });
  assert.equal(t.summary, "Marketing efficiency ratio");
  assert.equal(t.body, "Ventas / gasto en ads.");
  assert.throws(() => saveTerm(lib, { term: "Nuevo" }), /give it a summary/);
  assert.throws(() => saveTerm(lib, { term: "!!!", summary: "x" }), /letter or digit/);
  assert.throws(() => saveTerm(lib, { term: "x", summary: "y".repeat(241) }), /at most 240/);
  const multi = saveTerm(lib, { term: "Lista", summary: "una\nlínea", aliases: ["a, b", "[c]"] });
  assert.equal(multi.summary, "una línea", "the summary is one line");
  assert.deepEqual(findTerm(lib, "lista")?.aliases, ["a b", "c"], "commas and brackets cannot break the list");
});

test("the same word spelled differently is the same term and keeps its name; README is not a term; remove deletes", () => {
  const lib = tempDir();
  saveTerm(lib, { term: "Árbol", summary: "uno" });
  const second = saveTerm(lib, { term: "arbol!", summary: "dos" });
  assert.equal(second.created, false);
  assert.equal(second.term, "Árbol");
  assert.deepEqual(second.aliases, [], "the same slug is not added as an alias");
  writeFileSync(join(lib, "dictionary", "README.md"), "# dictionary\n");
  assert.deepEqual(listTerms(lib).map((t) => [t.term, t.summary]), [["Árbol", "dos"]]);
  const gone = removeTerm(lib, "arbol");
  assert.ok(!existsSync(join(lib, gone.path)));
  assert.throws(() => removeTerm(lib, "arbol"), /No term/);
});

test("rename with `from`: the name and the file change, the rest stays; a clash or an unknown term is refused", () => {
  const lib = tempDir();
  saveTerm(lib, { term: "Clinte", summary: "typo", aliases: ["c"], body: "texto" });
  saveTerm(lib, { term: "Otro", summary: "x" });
  const t = saveTerm(lib, { from: "clinte", term: "Cliente" });
  assert.equal(t.term, "Cliente");
  assert.equal(t.path, join("dictionary", "cliente.md"));
  assert.ok(!existsSync(join(lib, "dictionary", "clinte.md")), "the old file is gone");
  assert.deepEqual([t.aliases, t.summary, t.body], [["c"], "typo", "texto"]);
  assert.throws(() => saveTerm(lib, { from: "cliente", term: "otro" }), /already the term "Otro"/);
  assert.throws(() => saveTerm(lib, { from: "nadie", term: "x" }), /No term "nadie" to rename/);
});

test("nexo dict: add, list, show, rm, and library/index.json lists every term with its summary", async () => {
  const root = await freshEnv("claude");
  assert.match(dict("list", [], { root }), /dictionary is empty/);
  assert.equal(dict("add", ["Cliente", "activo"], { root, summary: "Compró en 90 días", alias: "activo,vigente", body: "Detalle." }), 'Added "Cliente activo" in library/dictionary/cliente-activo.md.');
  assert.match(dict("add", ["vigente"], { root, summary: "Compró en 60 días" }), /^Updated "Cliente activo"/);
  assert.equal(dict("list", [], { root }), "Cliente activo (activo, vigente) — Compró en 60 días");
  assert.equal(dict("show", ["activo"], { root }), "Cliente activo (activo, vigente)\nCompró en 60 días\n\nDetalle.");
  const index = json(join(root, "library", "index.json"));
  assert.deepEqual(index.dictionary, [{ term: "Cliente activo", aliases: ["activo", "vigente"], summary: "Compró en 60 días", path: "dictionary/cliente-activo.md" }]);
  assert.equal(dict("rm", ["cliente activo"], { root }), 'Removed "Cliente activo".');
  assert.deepEqual(json(join(root, "library", "index.json")).dictionary, []);
  assert.throws(() => dict("add", [], { root }), /Usage: nexo dict/);
  assert.throws(() => dict("show", ["nada"], { root }), /No term "nada"/);
  assert.throws(() => dict("explode", ["x"], { root }), /Usage/);
});
