import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "./http.ts";

const dir = mkdtempSync(join(tmpdir(), "json-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("a damaged JSON file is kept aside, not silently replaced by the next save", () => {
  const file = join(dir, "notes.json");
  writeFileSync(file, '[{"id":1,"text":"keep me"'); // truncated by a crash
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.deepEqual(readJson(file, []), []);
  } finally {
    console.error = orig;
  }
  const aside = readdirSync(dir).find((f) => f.startsWith("notes.json.corrupt-"));
  assert.ok(aside, "a copy of the damaged file exists");
  assert.match(readFileSync(join(dir, aside!), "utf8"), /keep me/);
  assert.equal(errors.length, 1);
  assert.deepEqual(readJson(join(dir, "missing.json"), { a: 1 }), { a: 1 }, "a missing file is just the fallback");
});

test("writeJson writes atomically and leaves no temporary files", () => {
  const file = join(dir, "sub", "state.json");
  writeJson(file, { n: 1 });
  writeJson(file, { n: 2 });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { n: 2 });
  assert.deepEqual(readdirSync(join(dir, "sub")), ["state.json"]);
});
