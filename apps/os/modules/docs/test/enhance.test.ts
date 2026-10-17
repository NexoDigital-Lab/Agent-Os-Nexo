// enhance.ts: heading ids must match GitHub's, so a #link in a doc works both on GitHub and in the reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headingId, readingMinutes } from "../web/enhance.ts";

test("headingId gives GitHub's id: accents kept, punctuation dropped, each space a hyphen", () => {
  assert.equal(headingId("Personalize it"), "personalize-it");
  assert.equal(headingId("Cómo empezar"), "cómo-empezar");
  assert.equal(headingId("A & B"), "a--b");
  assert.equal(headingId("R1–R12: rules (v2)"), "r1r12-rules-v2");
  assert.equal(headingId("snake_case and kebab-case"), "snake_case-and-kebab-case");
  assert.equal(headingId("  Atención  "), "atención");
  assert.equal(headingId("¿Qué es?"), "qué-es");
});

test("readingMinutes: 200 words a minute, at least one", () => {
  assert.equal(readingMinutes(""), 1);
  assert.equal(readingMinutes("word ".repeat(1000)), 5);
});
