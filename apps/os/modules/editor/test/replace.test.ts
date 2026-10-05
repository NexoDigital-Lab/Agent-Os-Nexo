import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceInRepo } from "../server/search.ts";

const root = mkdtempSync(join(tmpdir(), "replace-"));
after(() => rmSync(root, { recursive: true, force: true }));

test("regex replace expands real groups only: $n past the last group is empty, never the file", () => {
  writeFileSync(join(root, "a.ts"), "foo1 foo2\nbar\n");
  const r = replaceInRepo(root, { q: "foo(\\d)", regex: true, matchCase: true, replacement: "x$1$3[$&]", files: ["a.ts"] });
  assert.equal(r.total, 2);
  assert.equal(readFileSync(join(root, "a.ts"), "utf8"), "x1[foo1] x2[foo2]\nbar\n");
});

test("plain replace keeps $ literally, and a missing replacement is refused", () => {
  writeFileSync(join(root, "b.ts"), "price\n");
  replaceInRepo(root, { q: "price", replacement: "$1 cost", files: ["b.ts"] });
  assert.equal(readFileSync(join(root, "b.ts"), "utf8"), "$1 cost\n");
  assert.throws(() => replaceInRepo(root, { q: "cost", files: ["b.ts"] } as never), /replacement must be text/);
  assert.equal(readFileSync(join(root, "b.ts"), "utf8"), "$1 cost\n", "nothing was written");
});

test("replace never leaves the repository", () => {
  assert.throws(() => replaceInRepo(root, { q: "x", replacement: "y", files: ["../outside.ts"] }));
});
