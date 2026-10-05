import test from "node:test";
import assert from "node:assert/strict";
import { composeReview, lineNumbers, resolveLine } from "../web/review/logic.ts";
import { addMessages, setLanguage } from "../../../host/web/src/i18n.ts";
import { es } from "../web/messages.ts";

test("resolveLine: same text is not moved; relocated text reports the new line", () => {
  const c = { line: 2, snippet: "  const a = 1;" };
  assert.deepEqual(resolveLine(c, ["x", "const a = 1;"]), { moved: false, line: 2 });
  assert.deepEqual(resolveLine(c, ["x", "y", "const a = 1;"]), { moved: true, line: 3 });
  assert.deepEqual(resolveLine(c, ["x"]), { moved: true, line: 2 });
  assert.deepEqual(resolveLine(c, null), { moved: false, line: 2 });
});

test("composeReview: header, numbered path:line, quote, comment", () => {
  const out = composeReview(
    [{ id: "a", path: "src/a.ts", line: 4, snippet: "foo()", text: "renombrar", at: 0 }],
    { a: { moved: true, line: 6 } },
  );
  assert.match(out, /^I reviewed your changes; fix this:/);
  assert.match(out, /1\. `src\/a\.ts:6` \(the line moved; it was 4\)\n {3}> foo\(\)\n {3}renombrar/);
  addMessages({ es });
  setLanguage("es");
  const outEs = composeReview([{ id: "a", path: "src/a.ts", line: 4, snippet: "foo()", text: "renombrar", at: 0 }], { a: { moved: true, line: 6 } });
  setLanguage("en");
  assert.match(outEs, /^Revisé tus cambios; corregí esto:/);
  assert.match(outEs, /\(la línea se movió; antes era la 4\)/);
});

test("lineNumbers: new-side numbering from hunks, none for removed/header lines", () => {
  const n = lineNumbers(["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,2 +10,3 @@", " ctx", "-old", "+new"]);
  assert.deepEqual(n, [null, null, null, null, 10, null, 11]);
});
