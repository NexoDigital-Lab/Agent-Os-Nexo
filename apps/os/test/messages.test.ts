// How t() treats a key's context ("All::containers"). Clashes between modules' dictionaries are rule M5 of
// scripts/check-modules.ts (test/module-rules.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMessages, setLanguage, t } from "../host/web/src/i18n.ts";

test("a key's context is hidden in English and picks its own translation", () => {
  addMessages({ es: { All: "Todo", "All::containers": "Todos" } });
  setLanguage("en");
  assert.equal(t("All::containers"), "All");
  setLanguage("es");
  assert.equal(t("All::containers"), "Todos");
  assert.equal(t("All"), "Todo");
  assert.equal(t("Missing::ctx"), "Missing", "untranslated keys fall back without the context");
  for (const raw of ["connect ECONNREFUSED ::1:443", "std::io::Error", "::error::build failed", "a :: b"]) assert.equal(t(raw), raw, raw);
  setLanguage("en");
});
