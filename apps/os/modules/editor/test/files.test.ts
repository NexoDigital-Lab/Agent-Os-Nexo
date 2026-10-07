// File operations of the editor, scoped to one repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import { createEntry, deleteEntry, imagePath, listFiles, moveEntry, readText, renameEntry, writeText } from "../server/files.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

function repo() {
  const root = tempDir("editor-files-");
  git(root, "init", "-q");
  return root;
}

test("listFiles lists tracked and untracked files with line counts, skips ignored ones and reports empty folders", async () => {
  const root = repo();
  writeFileSync(join(root, ".gitignore"), "ignored.txt\nbuild/\n");
  writeFileSync(join(root, "a.txt"), "one\ntwo\n");
  writeFileSync(join(root, "ignored.txt"), "x");
  writeFileSync(join(root, "bin.dat"), Buffer.from([1, 0, 2]));
  writeFileSync(join(root, "big.txt"), Buffer.alloc(1024 * 1024 + 1, "a"));
  mkdirSync(join(root, "empty", "inner"), { recursive: true });
  mkdirSync(join(root, "build", "out"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pkg", "i.js"), "x");
  const list = await listFiles(root);
  const byPath = new Map(list.map((f) => [f.path, f]));
  assert.equal(byPath.get("a.txt")?.lines, 3);
  assert.equal(byPath.get("bin.dat")?.lines, 0, "binary files have no line count");
  assert.equal(byPath.get("big.txt")?.lines, 0, "files over 1 MB are not counted");
  assert.equal(byPath.has("ignored.txt"), false);
  assert.equal(byPath.get("empty/inner")?.dir, true);
  assert.equal(byPath.has("build/out"), false, "ignored empty folders are hidden");
});

test("listFiles outside a repository rejects (emptyDirs runs git without a fallback, unlike repoFiles)", async () => {
  await assert.rejects(listFiles(tempDir("editor-norepo-")));
});

test("readText reads, reports a missing file, and refuses binary, huge and out-of-repo files", () => {
  const root = repo();
  writeFileSync(join(root, "a.txt"), "héllo");
  writeFileSync(join(root, "b.bin"), Buffer.from([0, 1]));
  writeFileSync(join(root, "huge.txt"), Buffer.alloc(1024 * 1024 + 1, "a"));
  assert.deepEqual(readText(root, "a.txt"), { exists: true, content: "héllo" });
  assert.deepEqual(readText(root, "nope.txt"), { exists: false, content: "" });
  assert.throws(() => readText(root, "b.bin"), { status: 415 });
  assert.throws(() => readText(root, "huge.txt"), { status: 413 });
  assert.throws(() => readText(root, "../x"), { status: 400 });
  assert.throws(() => readText(root, ".git/config"), { status: 400 });
});

test("writeText creates missing folders", () => {
  const root = repo();
  writeText(root, "deep/er/f.txt", "data");
  assert.equal(readFileSync(join(root, "deep", "er", "f.txt"), "utf8"), "data");
});

test("safePath refuses a symlink that leaves the repository", (t) => {
  const root = repo();
  const outside = tempDir("editor-outside-");
  try {
    symlinkSync(outside, join(root, "link"), "dir");
  } catch {
    return t.skip("symlinks not permitted here");
  }
  assert.throws(() => readText(root, "link/x.txt"), { status: 400 });
});

test("createEntry makes files and folders, never overwrites, rejects empty names", () => {
  const root = repo();
  assert.deepEqual(createEntry(root, "src/utils/date.ts", "file"), { path: "src/utils/date.ts" });
  assert.equal(statSync(join(root, "src", "utils", "date.ts")).size, 0);
  assert.deepEqual(createEntry(root, "docs/new", "dir"), { path: "docs/new" });
  assert.ok(statSync(join(root, "docs", "new")).isDirectory());
  assert.throws(() => createEntry(root, "src/utils/date.ts", "file"), { status: 409 });
  assert.throws(() => createEntry(root, "  ", "file"), { status: 400 });
  assert.throws(() => createEntry(root, "dir/", "dir"), { status: 400 });
  assert.throws(() => createEntry(root, ".", "dir"), { status: 400 });
});

test("renameEntry renames in place and validates the name and the target", () => {
  const root = repo();
  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, "b.txt"), "b");
  mkdirSync(join(root, "d"));
  writeFileSync(join(root, "d", "c.txt"), "c");
  assert.deepEqual(renameEntry(root, "d/c.txt", "z.txt"), { path: "d/z.txt" });
  assert.ok(existsSync(join(root, "d", "z.txt")));
  assert.deepEqual(renameEntry(root, "a.txt", "a.txt"), { path: "a.txt" });
  assert.throws(() => renameEntry(root, "a.txt", "b.txt"), { status: 409 });
  assert.throws(() => renameEntry(root, "a.txt", "x/y"), { status: 400 });
  assert.throws(() => renameEntry(root, "a.txt", ".."), { status: 400 });
  assert.throws(() => renameEntry(root, "a.txt", " "), { status: 400 });
  assert.throws(() => renameEntry(root, "", "x"), { status: 400 });
  assert.throws(() => renameEntry(root, "ghost.txt", "x"), { status: 404 });
});

test("moveEntry moves into a folder, never overwrites or nests a folder in itself", () => {
  const root = repo();
  writeFileSync(join(root, "a.txt"), "a");
  mkdirSync(join(root, "d", "sub"), { recursive: true });
  writeFileSync(join(root, "d", "a.txt"), "other");
  writeFileSync(join(root, "m.txt"), "m");
  assert.throws(() => moveEntry(root, "a.txt", "d"), { status: 409 });
  assert.deepEqual(moveEntry(root, "m.txt", "d"), { path: "d/m.txt" });
  assert.deepEqual(moveEntry(root, "d/m.txt", "d"), { path: "d/m.txt" }, "same place is a no-op");
  assert.deepEqual(moveEntry(root, "d/m.txt", "new/folder"), { path: "new/folder/m.txt" });
  assert.deepEqual(moveEntry(root, "new/folder/m.txt", ""), { path: "m.txt" }, "'' is the repository root");
  assert.throws(() => moveEntry(root, "d", "d/sub"), { status: 400 });
  assert.throws(() => moveEntry(root, "d", "d"), { status: 400 });
  assert.throws(() => moveEntry(root, "", "d"), { status: 400 });
  assert.throws(() => moveEntry(root, "ghost", "d"), { status: 404 });
});

test("imagePath only serves images that exist inside the repository", () => {
  const root = repo();
  writeFileSync(join(root, "p.PNG"), "x");
  assert.equal(imagePath(root, "p.PNG"), join(root, "p.PNG"));
  assert.throws(() => imagePath(root, "a.txt"), { status: 415 });
  assert.throws(() => imagePath(root, "missing.png"), { status: 404 });
  assert.throws(() => imagePath(root, "../x.png"), { status: 400 });
});

test("deleteEntry refuses the root and missing paths; a real delete goes to the trash or leaves the file alone", async () => {
  const root = repo();
  const data = tempDir("editor-xdg-");
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = data; // never touch the real trash
  try {
    await assert.rejects(deleteEntry(root, ""), { status: 400 });
    await assert.rejects(deleteEntry(root, "ghost.txt"), { status: 404 });
    writeFileSync(join(root, "gone.txt"), "x");
    const r = await deleteEntry(root, "gone.txt").catch((e: Error & { status?: number }) => e);
    if (r instanceof Error) {
      assert.equal((r as { status?: number }).status, 500);
      assert.match(r.message, /Nothing was deleted/);
      assert.ok(existsSync(join(root, "gone.txt")));
    } else {
      assert.deepEqual(r, { trashed: true });
      assert.equal(existsSync(join(root, "gone.txt")), false);
    }
  } finally {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
  }
});
