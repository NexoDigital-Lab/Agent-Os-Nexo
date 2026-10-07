// What detectStacks reads from a repository's manifests, in real git repos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import { detectStacks } from "../server/stacks.ts";

function repo(files: Record<string, string>) {
  const dir = tempDir("agent-os-stacks-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}
const keys = async (files: Record<string, string>) => (await detectStacks(repo(files))).map((s) => s.key).sort();
const pkg = (deps: object = {}, dev: object = {}) => JSON.stringify({ dependencies: deps, devDependencies: dev });

test("a Next + Tailwind + Prisma app is recognised from package.json, with the evidence", async () => {
  const stacks = await detectStacks(repo({ "package.json": pkg({ next: "1", react: "1", "@prisma/client": "1" }, { tailwindcss: "1", typescript: "5", eslint: "9" }) }));
  assert.deepEqual(stacks.map((s) => s.key).sort(), ["eslint", "next", "prisma", "react", "tailwind", "typescript"]);
  assert.equal(stacks.find((s) => s.key === "next")!.evidence, "next in package.json");
});

test("backend frameworks mean api; nest, mongo, expo, react-native, astro and vue are detected", async () => {
  assert.deepEqual(await keys({ "apps/x/package.json": pkg({ express: "1", mongoose: "1" }) }), ["api", "javascript", "mongodb"]);
  assert.deepEqual(await keys({ "package.json": pkg({ "@nestjs/core": "1", expo: "1", "react-native": "1", astro: "1", vue: "1" }) }), ["api", "astro", "expo", "javascript", "nest", "react-native", "vue"]);
});

test("a package.json without typescript is javascript, unless a tsconfig exists", async () => {
  const plain = await detectStacks(repo({ "package.json": pkg() }));
  assert.deepEqual(plain, [{ key: "javascript", evidence: "package.json without TypeScript" }]);
  assert.deepEqual(await keys({ "package.json": pkg(), "tsconfig.json": "{}" }), ["typescript"]);
});

test("an unreadable package.json is skipped instead of failing", async () => {
  assert.deepEqual(await keys({ "package.json": "{ not json" }), ["javascript"]);
});

test("files deeper than three segments are ignored for manifests", async () => {
  assert.deepEqual(await keys({ "a/b/c/package.json": pkg({ next: "1" }) }), []);
});

test("go: a go.mod is a go api; loose .go files are only go", async () => {
  const withMod = await detectStacks(repo({ "go.mod": "module x", "main.go": "package main" }));
  assert.deepEqual(withMod.map((s) => s.key), ["go", "api"]);
  assert.equal(withMod[1]!.evidence, "go.mod (Go backend)");
  assert.deepEqual(await detectStacks(repo({ "cmd/main.go": "package main" })), [{ key: "go", evidence: ".go files" }]);
});

test("python: manifests, fastapi and django hints, or just .py files", async () => {
  assert.deepEqual(await keys({ "requirements.txt": "FastAPI==1\n" }), ["api", "fastapi", "python"]);
  assert.deepEqual(await keys({ "pyproject.toml": "dependencies = ['Django']" }), ["api", "django", "python"]);
  assert.deepEqual(await keys({ "Pipfile": "[packages]" }), ["python"]);
  assert.deepEqual(await detectStacks(repo({ "tool.py": "print(1)" })), [{ key: "python", evidence: ".py files" }]);
});

test("docker, yaml and dotenv files at the top are picked up", async () => {
  assert.deepEqual(await keys({ Dockerfile: "FROM x", ".env.example": "A=1", "ci.yml": "a: 1" }), ["docker", "dotenv", "yaml"]);
  assert.deepEqual(await keys({ "docker-compose.yaml": "services: {}" }), ["docker", "yaml"]);
});

test("static sites: html without package.json, and loose js", async () => {
  assert.deepEqual(await keys({ "index.html": "<p>", "app.js": "1" }), ["javascript", "static"]);
  assert.deepEqual(await keys({ "index.html": "<p>" }), ["static"]);
});

test("a folder that is not a repository has no stacks", async () => {
  assert.deepEqual(await detectStacks(tempDir("agent-os-norepo-")), []);
});
