import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { basesDir } from "../src/core/paths.ts";
import { parseFrontmatter } from "../src/core/frontmatter.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(basesDir);

test("factory skills follow the format", () => {
  const skills = files.filter((f) => f.endsWith("SKILL.md"));
  assert.ok(skills.length >= 7);
  for (const file of skills) {
    const text = readFileSync(file, "utf8");
    const { data } = parseFrontmatter(text);
    for (const key of ["name", "description", "owner", "version"]) assert.ok(data[key], `${relative(basesDir, file)}: ${key}`);
    assert.equal(data.owner, "nexo");
    assert.ok(text.split("\n").length <= 200, `${relative(basesDir, file)} is over 200 lines`);
  }
});

test("environment AGENTS.md stays within 120 lines", () => {
  const text = readFileSync(join(basesDir, "environment", "AGENTS.md"), "utf8");
  assert.ok(text.split("\n").length <= 120);
});

test("every JSON file in nexo_bases parses", () => {
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(file, "utf8")), relative(basesDir, file));
  }
});

test("factory content carries no personal data", () => {
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\/home\/[a-z]/, `${relative(basesDir, file)} has a home path`);
    const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    for (const email of emails) assert.match(email, /@example\.com$/, `${relative(basesDir, file)}: ${email}`);
  }
});
