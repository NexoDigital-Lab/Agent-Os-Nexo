// uploads: temporary per-tab images — saving, name gatekeeping, the SDK message built from them, pruning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import { deleteUpload, dropUploads, pruneUploads, saveUpload, setUploadsDir, uploadPath, userMessage } from "../server/uploads.ts";

const root = tempDir("uploads-");
setUploadsDir(root);
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

test("saveUpload writes the file and returns its name and url; other formats are 415", () => {
  const r = saveUpload("tab1", PNG, "image/png");
  assert.match(r.name, /^img-\d+\.png$/);
  assert.equal(r.url, `/api/tabs/tab1/uploads/${r.name}`);
  assert.deepEqual(readFileSync(uploadPath("tab1", r.name)!), PNG);
  assert.throws(() => saveUpload("tab1", PNG, "image/svg+xml"), (e: any) => e.status === 415);
  assert.match(saveUpload("tab1", PNG, "image/jpeg").name, /\.jpg$/);
});

test("uploadPath only resolves generated names that exist", () => {
  assert.equal(uploadPath("tab1", "../secret.png"), null);
  assert.equal(uploadPath("tab1", "img-1.exe"), null);
  assert.equal(uploadPath("tab1", "img-999.png"), null, "valid name, no file");
});

test("userMessage: plain text without images, image blocks plus a note with them", () => {
  assert.deepEqual(userMessage("tab1", "hi"), { type: "user", parent_tool_use_id: null, message: { role: "user", content: "hi" } });
  const { name } = saveUpload("tab2", PNG, "image/png");
  const msg = userMessage("tab2", "look", [name, "img-0.png"]);
  const content = msg.message.content as any[];
  assert.equal(content.length, 2, "the unknown image is dropped");
  assert.equal(content[0].type, "image");
  assert.equal(content[0].source.media_type, "image/png");
  assert.equal(content[0].source.data, PNG.toString("base64"));
  assert.match(content[1].text, /^look\n\n\[1 image\(s\) attached, saved temporarily at: .*img-/);
  assert.equal(userMessage("tab2", "x", ["img-0.png"]).message.content, "x");
});

test("deleteUpload removes one file and ignores bad names", () => {
  const { name } = saveUpload("tab3", PNG, "image/gif");
  const file = uploadPath("tab3", name)!;
  deleteUpload("tab3", name);
  assert.equal(existsSync(file), false);
  deleteUpload("tab3", "../../x");
});

test("dropUploads and pruneUploads remove a tab's folder; prune keeps live tabs", () => {
  saveUpload("alive", PNG, "image/png");
  saveUpload("dead", PNG, "image/png");
  pruneUploads((t) => t === "alive");
  assert.equal(existsSync(join(root, "dead")), false);
  assert.equal(existsSync(join(root, "alive")), true);
  dropUploads("alive");
  assert.equal(existsSync(join(root, "alive")), false);
});

test("pruneUploads does nothing when the folder does not exist", () => {
  const other = join(tempDir("uploads-none-"), "missing");
  setUploadsDir(other);
  pruneUploads(() => false);
  assert.equal(existsSync(other), false);
  mkdirSync(join(root, "x"), { recursive: true });
  writeFileSync(join(root, "x", "f"), "");
  setUploadsDir(root);
});
