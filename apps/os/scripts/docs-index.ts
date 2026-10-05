// Writes docs/README.md from the documents' frontmatter, after checking the docs (translations, outlines,
// links). --check only verifies, for CI and tests: exit 1 when the docs have a problem or the index is stale.
//   node scripts/docs-index.ts [--check]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDocs, renderIndex } from "../src/core/docs.ts";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");

function main() {
  const check = process.argv.includes("--check");
  const problems = checkDocs(docsDir);
  const index = renderIndex(docsDir);
  const file = join(docsDir, "README.md");
  const stale = !existsSync(file) || readFileSync(file, "utf8") !== index;
  if (check && stale) problems.push("docs/README.md is out of date: run `npm run docs`");
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  if (!check) {
    writeFileSync(file, index);
    console.log("docs/README.md updated.");
  } else console.log("The docs are complete in every language and the index is current.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
