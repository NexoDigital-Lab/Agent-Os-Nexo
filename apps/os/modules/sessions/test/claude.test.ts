import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathAllowed, toolPaths } from "../server/claude.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "conf-"));
const cwd = path.join(tmp, "repo");
const extra = path.join(tmp, "biz");
const outside = path.join(tmp, "outside");
for (const d of [cwd, extra, outside]) mkdirSync(d);
symlinkSync(outside, path.join(cwd, "link"));

test("pathAllowed: inside cwd (relative and absolute) and extra dirs", () => {
  assert.ok(pathAllowed("src/a.ts", cwd));
  assert.ok(pathAllowed(".", cwd));
  assert.ok(pathAllowed(path.join(cwd, "x/y.ts"), cwd));
  assert.ok(pathAllowed(path.join(extra, "ctx.md"), cwd, [extra]));
});

test("pathAllowed: denies '..' escapes, siblings with the same prefix, absolute outside, ~ and symlinks", () => {
  assert.equal(pathAllowed("../outside/x", cwd), false);
  assert.equal(pathAllowed("src/../../outside", cwd), false);
  assert.equal(pathAllowed(cwd + "-evil/x", cwd), false);
  assert.equal(pathAllowed("/etc/passwd", cwd), false);
  assert.equal(pathAllowed("~/.ssh/id_rsa", cwd), false);
  assert.equal(pathAllowed("link/secret", cwd), false);
  assert.equal(pathAllowed(path.join(extra, "x"), cwd), false); // extra dir not granted
});

test("toolPaths: collects file_path/path and absolute globs, flags '..' in globs", () => {
  assert.deepEqual(toolPaths("Read", { file_path: "a.ts" }).paths, ["a.ts"]);
  assert.deepEqual(toolPaths("Grep", { pattern: "../../x", path: "src" }), { paths: ["src"], bad: false }); // regex, not a path
  assert.equal(toolPaths("Glob", { pattern: "../**/*.ts" }).bad, true);
  assert.equal(toolPaths("Grep", { pattern: "x", glob: "../*" }).bad, true);
  assert.deepEqual(toolPaths("Glob", { pattern: "/etc/*.conf" }).paths, ["/etc/"]);
  assert.equal(pathAllowed("/etc/", cwd), false);
});
