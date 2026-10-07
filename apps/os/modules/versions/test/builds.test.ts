import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildsState, pin } from "../server/builds.ts";

const osDir = mkdtempSync(join(tmpdir(), "agent-os-nexo-versions-"));
after(() => rmSync(osDir, { recursive: true, force: true }));
for (const v of ["1.0.0", "1.0.9", "1.1.0"]) mkdirSync(join(osDir, "versions", v), { recursive: true });
writeFileSync(join(osDir, "versions", "1.1.0", "build.json"), JSON.stringify({ version: "1.1.0", builtAt: "2026-10-05T10:00:00Z", notes: "Themes" }));

test("lists builds newest first with their notes; the newest loads by default", () => {
  const s = buildsState(osDir, "1.0.9");
  assert.deepEqual(s.builds.map((b) => b.version), ["1.1.0", "1.0.9", "1.0.0"]);
  assert.equal(s.builds[0]?.notes, "Themes");
  assert.equal(s.pinned, null);
  assert.equal(s.next, "1.1.0");
});

test("pinning chooses the next start; null goes back to the newest", () => {
  pin(osDir, "1.0.0");
  assert.equal(buildsState(osDir, "1.1.0").next, "1.0.0");
  assert.throws(() => pin(osDir, "9.9.9"), /No build 9\.9\.9/);
  pin(osDir, null);
  assert.ok(!existsSync(join(osDir, "current")));
  assert.equal(buildsState(osDir, "1.1.0").next, "1.1.0");
});
