import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGE_RE } from "../shared/fileKinds.ts";

test("IMAGE_RE matches image extensions case-insensitively and nothing else", () => {
  for (const f of ["a.png", "b/c.JPG", "d.jpeg", "e.gif", "f.webp", "g.svg", "h.ico", "i.bmp", "j.avif"]) assert.ok(IMAGE_RE.test(f), f);
  for (const f of ["a.txt", "png", "a.png.bak", "a.pngx"]) assert.equal(IMAGE_RE.test(f), false, f);
});
