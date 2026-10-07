// The repository's scripts: a version build (without the web UI, which Vite would take long to build) and the docs index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../host/test/harness.ts";
import { skipInModules } from "../scripts/build.ts";
import { docsIndex } from "../scripts/docs-index.ts";
import { renderIndex } from "../src/core/docs.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = (...args: string[]) => spawnSync(process.execPath, [join(appDir, "scripts", "build.ts"), ...args], { encoding: "utf8" });

test("build: a version carries the server code and build.json, never tests or web sources", () => {
  const out = join(tempDir(), "1.0.4");
  const r = build("--out", out, "--version", "1.0.4", "--notes", "a fix", "--runtime", "abc", "--skip-web");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agent-os 1\.0\.4 built \(\d+ modules, no web UI\)/);
  assert.deepEqual({ ...JSON.parse(readFileSync(join(out, "build.json"), "utf8")), builtAt: undefined }, { version: "1.0.4", notes: "a fix", runtime: "abc", builtAt: undefined });
  assert.ok(existsSync(join(out, "host", "server", "main.ts")));
  assert.ok(existsSync(join(out, "modules", "docs", "module.json")));
  assert.ok(!existsSync(join(out, "host", "server", "app.test.ts")), "tests stay out");
  assert.ok(!existsSync(join(out, "modules", "docs", "test")));
  assert.ok(!existsSync(join(out, "modules", "docs", "web")), "web sources stay out");
  assert.ok(!existsSync(join(out, "dist")));
});

test("build: refuses without --out and --version, or into the source folder", () => {
  const usage = build("--version", "1.0.0");
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /^build: Usage: node scripts\/build\.ts --out <dir> --version/);
  const inside = build("--out", join(appDir, "dist", "x"), "--version", "1.0.0", "--skip-web");
  assert.match(inside.stderr, /--out must be outside the source folder/);
});

test("build: what a version leaves out of modules/", () => {
  assert.ok(skipInModules("docs/web/index.tsx"));
  assert.ok(skipInModules("docs\\test\\a.ts"), "Windows separators too");
  assert.ok(skipInModules("x/node_modules/y"));
  assert.ok(skipInModules("docs/server/index.test.ts"));
  assert.ok(!skipInModules("docs/server/index.ts"));
});

test("docs index: checks, writes the index, and fails on a stale index or a broken doc", () => {
  const dir = join(tempDir(), "docs");
  const doc = (title: string) => `---\ntitle: ${title}\nsummary: s\norder: 1\n---\n\n# ${title}\n\n## One\n\ntext\n`;
  mkdirSync(join(dir, "en"), { recursive: true });
  mkdirSync(join(dir, "es"));
  writeFileSync(join(dir, "en", "start.md"), doc("Start"));
  writeFileSync(join(dir, "es", "start.md"), doc("Empezar"));
  writeFileSync(join(dir, "README.md"), renderIndex(dir));
  const out: string[] = [];
  const log = (m: string) => out.push(`log ${m}`);
  const error = (m: string) => out.push(`error ${m}`);
  assert.equal(docsIndex(dir, true, log, error), 0);
  writeFileSync(join(dir, "README.md"), "stale\n");
  assert.equal(docsIndex(dir, true, log, error), 1);
  assert.equal(docsIndex(dir, false, log, error), 0, "writing the index fixes it");
  assert.equal(docsIndex(dir, true, log, error), 0);
  const en = readdirSync(join(dir, "en")).find((f) => f.endsWith(".md"))!;
  writeFileSync(join(dir, "en", en), "no frontmatter\n");
  assert.equal(docsIndex(dir, false, log, error), 1);
  assert.deepEqual(out.slice(0, 4).map((l) => l.split(" ")[0]), ["log", "error", "log", "log"]);
  assert.ok(out.some((l) => l.startsWith("error ") && l !== "error docs/README.md is out of date: run `npm run docs`"));
});
