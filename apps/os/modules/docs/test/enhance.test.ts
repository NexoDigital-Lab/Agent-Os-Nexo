// enhance.ts: heading ids must match GitHub's, so a #link in a doc works both on GitHub and in the reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headingId, readingMinutes, uniqueIds } from "../web/enhance.ts";

test("headingId gives GitHub's id: accents kept, punctuation dropped, each space a hyphen", () => {
  assert.equal(headingId("Personalize it"), "personalize-it");
  assert.equal(headingId("Cómo empezar"), "cómo-empezar");
  assert.equal(headingId("A & B"), "a--b");
  assert.equal(headingId("R1–R12: rules (v2)"), "r1r12-rules-v2");
  assert.equal(headingId("snake_case and kebab-case"), "snake_case-and-kebab-case");
  assert.equal(headingId("  Atención  "), "atención");
  assert.equal(headingId("¿Qué es?"), "qué-es");
  assert.equal(headingId("Co\u0301mo"), "cómo", "a decomposed accent (macOS tools) gives the same id as a precomposed one");
  assert.equal(headingId("a\u00a0b\tc"), "abc", "only the ASCII space becomes a hyphen; other whitespace is dropped");
});

test("uniqueIds numbers repeats like GitHub, skipping ids already taken", () => {
  assert.deepEqual(uniqueIds(["Foo", "Foo", "Foo 1"]), ["foo", "foo-1", "foo-1-1"]);
  assert.deepEqual(uniqueIds(["Foo 1", "Foo", "Foo"]), ["foo-1", "foo", "foo-2"]);
  assert.deepEqual(uniqueIds(["?", "!"]), ["section", "section-1"]);
});

test("readingMinutes: 200 words a minute, at least one", () => {
  assert.equal(readingMinutes(""), 1);
  assert.equal(readingMinutes("word ".repeat(1000)), 5);
});
