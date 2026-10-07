// Writes docs/README.md from the documents' frontmatter, after checking the docs (translations, outlines,
// links). --check only verifies, for CI and tests: exit 1 when the docs have a problem or the index is stale.
//   node scripts/docs-index.ts [--check]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDocs, renderIndex } from "../src/core/docs.ts";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");

/** Checks the docs in `dir` and writes their index (or only verifies it, with `check`). Returns the exit code. */
export function docsIndex(dir: string, check: boolean, log = console.log, error = console.error): number {
  const problems = checkDocs(dir);
  const index = renderIndex(dir);
  const file = join(dir, "README.md");
  const stale = !existsSync(file) || readFileSync(file, "utf8") !== index;
  if (check && stale) problems.push("docs/README.md is out of date: run `npm run docs`");
  for (const p of problems) error(p);
  if (problems.length) return 1;
  if (!check) {
    writeFileSync(file, index);
    log("docs/README.md updated.");
  } else log("The docs are complete in every language and the index is current.");
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exit(docsIndex(docsDir, process.argv.includes("--check")));
}
