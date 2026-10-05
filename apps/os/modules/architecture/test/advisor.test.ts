import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanFile } from "../server/advisor.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "adv-"));
const repo = path.join(tmp, "repo");
const outside = path.join(tmp, "outside");
mkdirSync(path.join(repo, "src"), { recursive: true });
mkdirSync(outside);
writeFileSync(path.join(repo, "src", "a.ts"), "x");
writeFileSync(path.join(outside, "secret.txt"), "s");
symlinkSync(outside, path.join(repo, "link"));
symlinkSync(path.join(outside, "secret.txt"), path.join(repo, "src", "lnk.txt"));

test("cleanFile keeps a real repo file, normalized to forward slashes", () => {
  assert.equal(cleanFile(repo, "src/a.ts"), "src/a.ts");
  assert.equal(cleanFile(repo, "./src/../src/a.ts"), "src/a.ts");
  assert.equal(cleanFile(repo, path.join(repo, "src", "a.ts")), "src/a.ts");
});

test("cleanFile drops paths outside the repo: '..', absolute, symlinks", () => {
  assert.equal(cleanFile(repo, "../outside/secret.txt"), null);
  assert.equal(cleanFile(repo, path.join(outside, "secret.txt")), null);
  assert.equal(cleanFile(repo, "/etc/passwd"), null);
  assert.equal(cleanFile(repo, "link/secret.txt"), null);
  assert.equal(cleanFile(repo, "src/lnk.txt"), null);
});

test("cleanFile drops directories, the repo root, missing files and .git", () => {
  assert.equal(cleanFile(repo, "src"), null);
  assert.equal(cleanFile(repo, "."), null);
  assert.equal(cleanFile(repo, "src/nope.ts"), null);
  assert.equal(cleanFile(repo, ".git/config"), null);
});
