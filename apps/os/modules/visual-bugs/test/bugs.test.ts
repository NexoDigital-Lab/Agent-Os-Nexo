import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bugPath, deleteBug, initBugs, listBugs, saveBug, setNote } from "../server/bugs.ts";

const dir = mkdtempSync(join(tmpdir(), "agent-os-nexo-bugs-"));
after(() => rmSync(dir, { recursive: true, force: true }));
initBugs(dir);

test("save, annotate, list newest first and delete screenshots", () => {
  const a = saveBug(Buffer.from("a"), "image/png");
  const b = saveBug(Buffer.from("b"), "image/webp", "menu overlaps");
  assert.match(a.name, /^bug-\d{8}-\d{6}-\d+\.png$/);
  assert.notEqual(a.name, b.name);
  assert.deepEqual(listBugs().map((x) => x.name), [b.name, a.name]);
  setNote(a.name, "button cut off");
  assert.equal(listBugs()[1]?.note, "button cut off");
  assert.throws(() => setNote("bug-00000000-000000-1.png", "x"), /not found/);
  assert.throws(() => saveBug(Buffer.from("x"), "image/svg+xml"), /Unsupported/);
  assert.equal(bugPath("../index.json"), null);
  deleteBug(a.name);
  assert.deepEqual(listBugs().map((x) => x.name), [b.name]);
});
