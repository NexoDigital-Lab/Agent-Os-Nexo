// Search (git grep) and the plain/regex/word/case branches of replace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import { replaceInRepo, searchRepo } from "../server/search.ts";

const root = tempDir("editor-search-");
execFileSync("git", ["init", "-q"], { cwd: root });
writeFileSync(join(root, "a.ts"), "Foo foo foobar\nnothing\nfoo(1)\n");
writeFileSync(join(root, "bin.dat"), Buffer.from("foo\0foo"));
writeFileSync(join(root, "many.txt"), "zz\n".repeat(2100));

test("an empty query finds nothing", async () => {
  assert.deepEqual(await searchRepo(root, { q: "" }), { hits: [], truncated: false });
});

test("search is case-insensitive by default, with line and column, and skips binary files", async () => {
  const { hits, truncated } = await searchRepo(root, { q: "foo" });
  assert.equal(truncated, false);
  // git grep reports the first match of each line.
  assert.deepEqual(hits.map((h) => [h.path, h.line, h.col]), [["a.ts", 1, 1], ["a.ts", 3, 1]]);
});

test("matchCase, word and regex narrow the results; no match is an empty list", async () => {
  assert.equal((await searchRepo(root, { q: "Foo", matchCase: true })).hits.length, 1);
  assert.equal((await searchRepo(root, { q: "foo", word: true })).hits.length, 2);
  assert.equal((await searchRepo(root, { q: "fo+\\(", regex: true })).hits[0].line, 3);
  assert.deepEqual((await searchRepo(root, { q: "absent-text" })).hits, []);
});

test("an invalid regex is a 400", async () => {
  await assert.rejects(searchRepo(root, { q: "(", regex: true }), { status: 400 });
});

test("results are capped at 2000 and flagged as truncated", async () => {
  const r = await searchRepo(root, { q: "zz" });
  assert.equal(r.hits.length, 2000);
  assert.equal(r.truncated, true);
});

test("replace validates its input", () => {
  assert.throws(() => replaceInRepo(root, { q: "", replacement: "x", files: [] }), { status: 400 });
  assert.throws(() => replaceInRepo(root, { q: "(", regex: true, replacement: "x", files: [] }), /Invalid regex/);
  assert.throws(() => replaceInRepo(root, { q: "a", replacement: "x", files: "a.ts" as never }), /files must be a list/);
  assert.throws(() => replaceInRepo(root, { q: "a", replacement: "x", files: [1 as never] }), /files must be a list/);
});

test("replace honors word and case options, skips missing and oversized files, and counts per file", () => {
  writeFileSync(join(root, "r.txt"), "cat Cat concat\n");
  writeFileSync(join(root, "huge.txt"), "cat" + "a".repeat(1024 * 1024));
  const r = replaceInRepo(root, { q: "cat", word: true, matchCase: true, replacement: "dog", files: ["r.txt", "missing.txt", "huge.txt"] });
  assert.deepEqual(r, { changed: [{ path: "r.txt", count: 1 }], total: 1 });
  assert.equal(readFileSync(join(root, "r.txt"), "utf8"), "dog Cat concat\n");
  const all = replaceInRepo(root, { q: "dog.*", regex: true, replacement: "[$&]", files: ["r.txt"] });
  assert.equal(all.total, 1);
  assert.equal(readFileSync(join(root, "r.txt"), "utf8"), "[dog Cat concat]\n");
});

test("a file with no match is left untouched and not reported", () => {
  const r = replaceInRepo(root, { q: "zzzzz-none", replacement: "x", files: ["a.ts"] });
  assert.deepEqual(r, { changed: [], total: 0 });
});
