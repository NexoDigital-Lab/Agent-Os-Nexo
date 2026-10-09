// Nothing personal in the repository (AGENTS.md rule 2): the code is developed inside a Nexo environment, next to the
// developer's own generated AI files, permissions and memory — none of that may ever be committed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const tracked = (): string[] => {
  try {
    return execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return []; // not a git checkout (a packed tarball): nothing to check
  }
};

/** What a Nexo environment generates next to a project, or keeps for one user: never part of this repository. */
const GENERATED = [
  /^(.*\/)?\.claude\/(?!CLAUDE\.md$)/,
  /^(.*\/)?\.mcp\.json$/,
  /^(.*\/)?opencode\.json$/,
  /^(.*\/)?\.(opencode|codex|gemini|engram|state)\//,
  /^(.*\/)?environment\.config\.json$/,
  /^(.*\/)?\.env(\..*)?$/,
];

test("no generated AI files, environment state or credentials are tracked", { skip: !tracked().length && "not a git checkout" }, () => {
  const bad = tracked().filter((f) => f !== ".env.example" && !f.endsWith("/.env.example") && GENERATED.some((re) => re.test(f)));
  assert.deepEqual(bad, [], "these belong to a developer's environment, not to the repository");
});

// Home folders in examples use placeholder names only; a real user name means a machine path leaked in.
const HOME = /(?:\/home\/|\/Users\/|[A-Za-z]:[\\/]+Users[\\/]+)([A-Za-z][\w.-]*)[\\/]/g;
const PLACEHOLDERS = new Set(["you", "me", "user", "u", "a", "x", "runner", "example", "name", "username"]);

test("no machine-specific home paths in tracked text files", { skip: !tracked().length && "not a git checkout" }, () => {
  const hits: string[] = [];
  for (const f of tracked()) {
    if (f.endsWith("package-lock.json") || !/\.(ts|tsx|js|mjs|json|md|yml|yaml|rs|toml|sh|ps1|css|html)$/.test(f)) continue;
    const text = readFileSync(join(repo, f), "utf8");
    for (const m of text.matchAll(HOME)) if (!PLACEHOLDERS.has(m[1]!.toLowerCase())) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], "use a placeholder (/home/you/…) instead of a real home folder");
});
