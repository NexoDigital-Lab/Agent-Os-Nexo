// The documentation exists in every language with the same outline, its links work, and docs/README.md (the
// index) matches the documents — and the checks really catch each problem they claim to.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocs, listDocs, readDoc, renderIndex } from "../src/core/docs.ts";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");

test("the docs are complete in English and Spanish, and the index is current", () => {
  assert.deepEqual(checkDocs(docsDir), []);
  const readme = readFileSync(join(docsDir, "README.md"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(readme, renderIndex(docsDir), "run `npm run docs`");
  assert.deepEqual(listDocs(docsDir, "es").map((d) => d.slug), listDocs(docsDir, "en").map((d) => d.slug));
});

const tmp = mkdtempSync(join(tmpdir(), "docs-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const write = (rel: string, text: string) => (mkdirSync(dirname(join(tmp, rel)), { recursive: true }), writeFileSync(join(tmp, rel), text));
const doc = (title: string, sections: string[], extra = "") =>
  `---\ntitle: ${title}\nsummary: s\norder: 1\n---\n\n# ${title}\n\n${sections.map((s) => `## ${s}\n\ntext\n`).join("\n")}${extra}`;

test("checkDocs catches a missing translation, a different outline, a broken link, a missing field", () => {
  write("en/a.md", doc("A", ["One", "Two"], "[b](b.md) [gone](nope.md)\n"));
  write("en/b.md", doc("B", ["One"]));
  write("es/a.md", doc("A es", ["Uno"]));
  write("es/c.md", "# no frontmatter\n");
  const problems = checkDocs(tmp).join("\n");
  assert.match(problems, /docs\/es\/b\.md is missing/);
  assert.match(problems, /docs\/es\/a\.md: 1 sections, the English one has 2/);
  assert.match(problems, /docs\/en\/a\.md: broken link nope\.md/);
  assert.match(problems, /docs\/es\/c\.md: frontmatter has no title/);
  assert.match(problems, /docs\/es\/c\.md: no English original/);
  assert.doesNotMatch(problems, /broken link b\.md/);
});

test("readDoc refuses slugs that could leave the docs folder", () => {
  assert.equal(readDoc(docsDir, "en", "../package"), null);
  assert.equal(readDoc(docsDir, "en", "module-rules")?.title, "Module rules");
  assert.equal(readDoc(docsDir, "es", "module-rules")?.title, "Reglas de módulos");
});
