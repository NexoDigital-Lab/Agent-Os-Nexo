import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRAST_PAIRS, DEFAULT_PALETTE, PALETTES, contrast, paletteById } from "../web/palettes.ts";

test("every palette keeps every text pair at WCAG AA (4.5:1) or better", () => {
  for (const p of PALETTES) {
    for (const [label, fg, bg] of CONTRAST_PAIRS) {
      const ratio = contrast(p.colors[fg], p.colors[bg]);
      assert.ok(ratio >= 4.5, `${p.name}: ${label} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("the default is Nexo and unknown ids fall back to it", () => {
  assert.equal(DEFAULT_PALETTE, "nexo");
  assert.equal(paletteById("nope").id, "nexo");
  assert.equal(new Set(PALETTES.map((p) => p.id)).size, PALETTES.length);
});

test("contrast is symmetric and spans 1 to 21", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#ffffff", "#000000").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#777777"), 1);
});
