// Path gatekeeping (safePath), the repo file list and the git wrapper, on real temp repos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import { git } from "../server/git.ts";
import { inside, realOrAncestor, repoFiles, safePath } from "../server/repo.ts";

const skipLinks = process.platform === "win32" ? "symlinks need privileges on Windows" : false;

test("inside is true for the root and what lies under it, not for siblings with the same prefix", () => {
  const root = path.resolve("/x/proj");
  assert.ok(inside(root, root));
  assert.ok(inside(root, path.join(root, "a", "b")));
  assert.ok(!inside(root, root + "-other"));
  assert.ok(!inside(root, path.resolve("/x")));
});

test("realOrAncestor resolves the nearest existing ancestor for a path not created yet", () => {
  const root = tempDir();
  assert.equal(realOrAncestor(path.join(root, "a", "b", "c")), realOrAncestor(root));
  assert.equal(realOrAncestor(root), realOrAncestor(path.join(root, "")));
});

test("safePath resolves paths inside the repo, including ones about to be created", () => {
  const root = tempDir();
  assert.equal(safePath(root, "src/new/file.ts"), path.join(root, "src", "new", "file.ts"));
  assert.equal(safePath(root, "."), root);
});

test("safePath rejects ../ escapes, absolute paths elsewhere and anything under .git", () => {
  const root = tempDir();
  assert.throws(() => safePath(root, "../x"), (e: any) => e.status === 400 && /outside the project/.test(e.message));
  assert.throws(() => safePath(root, path.resolve(root, "..", "x")), /outside the project/);
  assert.throws(() => safePath(root, ".git/config"), (e: any) => e.status === 400 && /\.git is not edited/.test(e.message));
  assert.throws(() => safePath(root, "a/.git"), /\.git/);
});

test("safePath rejects a symlink that leaves the repo", { skip: skipLinks }, () => {
  const root = tempDir();
  const outside = tempDir();
  symlinkSync(outside, path.join(root, "out"), "dir");
  assert.throws(() => safePath(root, "out/file.txt"), (e: any) => e.status === 400 && /symlink/.test(e.message));
  mkdirSync(path.join(root, "real"));
  symlinkSync(path.join(root, "real"), path.join(root, "in"), "dir");
  assert.equal(safePath(root, "in/f"), path.join(root, "in", "f"), "a symlink that stays inside is fine");
});

test("repoFiles lists tracked and untracked files but not ignored ones; empty outside a repo", async () => {
  const root = tempDir();
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(path.join(root, ".gitignore"), "skip.txt\n");
  writeFileSync(path.join(root, "a.txt"), "");
  writeFileSync(path.join(root, "skip.txt"), "");
  assert.deepEqual((await repoFiles(root)).sort(), [".gitignore", "a.txt"]);
  assert.deepEqual(await repoFiles(path.join(tempDir(), "gone")), []);
});

test("git returns stdout, and an empty string when git fails", async () => {
  const root = tempDir();
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  assert.equal((await git(root, "branch", "--show-current")).trim(), "main");
  assert.equal(await git(root, "log", "-1"), "", "no commits yet");
  assert.equal(await git(path.join(root, "missing"), "status"), "", "cwd that does not exist");
});
