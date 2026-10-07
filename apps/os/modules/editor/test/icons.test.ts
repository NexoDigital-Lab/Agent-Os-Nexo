import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ICONS_DIR, iconManifest } from "../server/icons.ts";

test("the manifest resolves every rule to an svg filename and is computed once", () => {
  const m = iconManifest();
  assert.match(m.file, /\.svg$/);
  assert.match(m.folder, /\.svg$/);
  assert.match(m.folderOpen, /\.svg$/);
  assert.match(m.fileExtensions.ts, /\.svg$/);
  assert.ok(Object.keys(m.fileNames).every((k) => k === k.toLowerCase()), "rule keys are lowercase");
  assert.equal(iconManifest(), m, "cached");
  assert.ok(existsSync(join(ICONS_DIR, m.file)), "the icon files are on disk");
});
