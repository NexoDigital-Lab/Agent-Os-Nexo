import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../src/core/frontmatter.ts";
import { compareVersions, nextVersion } from "../src/core/osversions.ts";
import { claudeBashRule, mergePermissions, toClaudePermissions, validatePermissions } from "../src/core/permissions.ts";
import { render } from "../src/core/fsx.ts";
import { repoName, validateName } from "../src/core/projects.ts";

test("frontmatter: scalars, quoted values and lists", () => {
  const { data, body, hasFrontmatter } = parseFrontmatter('---\nname: x\nowner: "nexo"\ntools: [read, grep]\n---\nbody\n');
  assert.equal(hasFrontmatter, true);
  assert.deepEqual(data, { name: "x", owner: "nexo", tools: ["read", "grep"] });
  assert.equal(body, "body\n");
  assert.equal(parseFrontmatter("no frontmatter").hasFrontmatter, false);
});

test("os versions: start at 1.0.0, roll the minor after .9, never touch the major", () => {
  assert.equal(nextVersion(null), "1.0.0");
  assert.equal(nextVersion("1.0.0"), "1.0.1");
  assert.equal(nextVersion("1.0.8"), "1.0.9");
  assert.equal(nextVersion("1.0.9"), "1.1.0");
  assert.equal(nextVersion("1.9.9"), "1.10.0");
  assert.equal(nextVersion("2.3.4"), "2.3.5");
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
});

test("permissions: Bash rules from command patterns", () => {
  assert.equal(claudeBashRule("git push*"), "Bash(git push:*)");
  assert.equal(claudeBashRule("docker *"), "Bash(docker:*)");
  assert.equal(claudeBashRule("npm test"), "Bash(npm test)");
});

test("permissions: translation to Claude uses absolute paths per decision", () => {
  const out = toClaudePermissions(
    { files: { read: { deny: ["projects/**/secrets/**"] }, edit: { ask: ["projects/**/code/**"] } }, commands: { allow: ["git status*"] } },
    "/env",
  );
  assert.deepEqual(out.deny, ["Read(//env/projects/**/secrets/**)"]);
  assert.deepEqual(out.ask, ["Edit(//env/projects/**/code/**)"]);
  assert.deepEqual(out.allow, ["Bash(git status:*)"]);
});

test("permissions: project rules extend global ones, project default wins", () => {
  const merged = mergePermissions(
    { default: "ask", commands: { allow: ["git status*"] } },
    { default: "deny", commands: { deny: ["psql *"] } },
  );
  assert.equal(merged.default, "deny");
  assert.deepEqual(merged.commands, { allow: ["git status*"], deny: ["psql *"] });
});

test("permissions: validation catches unknown decisions", () => {
  assert.deepEqual(validatePermissions({ default: "ask" }), []);
  assert.equal(validatePermissions({ os: { restart: "maybe" as never } }).length, 1);
  assert.equal(validatePermissions({ commands: { always: ["x"] } as never }).length, 1);
});

test("templates and names", () => {
  assert.equal(render("# {{name}} {{other}}", { name: "demo" }), "# demo {{other}}");
  assert.equal(repoName("git@github.com:Org/My-Repo.git"), "my-repo");
  assert.equal(repoName("https://github.com/org/app/"), "app");
  assert.throws(() => validateName("Bad Name"));
});

test("every published package carries the repository's LICENSE, unchanged", () => {
  const repo = join(import.meta.dirname, "..", "..", "..");
  const license = readFileSync(join(repo, "LICENSE"), "utf8");
  for (const pkg of ["packages/cli", "apps/os", "apps/desktop"]) {
    assert.equal(readFileSync(join(repo, pkg, "LICENSE"), "utf8"), license, `${pkg}/LICENSE differs: copy the root LICENSE again`);
  }
});
