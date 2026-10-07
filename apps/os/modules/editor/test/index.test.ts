// The editor's routes through real HTTP, against a tab opened on a throwaway repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { openTab, restoreTabs } from "../../sessions/server/agent.ts";
import register from "../server/index.ts";

const env = tempEnv({ system: { packageManager: "dnf" } });
initProjects(env);
const dir = join(env.projects, "demo");
const code = join(dir, "code");
mkdirSync(code, { recursive: true });
writeFileSync(join(dir, "AGENTS.md"), "# demo\n");
execFileSync("git", ["init", "-q"], { cwd: code });
writeFileSync(join(code, "hello.txt"), "hello world\nsecond line\n");
writeFileSync(join(code, "pic.png"), "not really a png");
restoreTabs(join(env.state, "tabs.json"));
const tab = openTab({ project: "demo", dir, cwd: code, title: "demo" });
const t = `/tabs/${tab}`;
const m = await mountModule(register, { env });

test("an unknown tab is a 404", async () => {
  assert.equal((await m.get("/tabs/nope/files")).status, 404);
});

test("files lists the repository and file reads and writes content", async () => {
  const files = await m.get(`${t}/files`);
  assert.ok(files.body.some((f: { path: string }) => f.path === "hello.txt"));
  assert.deepEqual((await m.get(`${t}/file?path=hello.txt`)).body, { exists: true, content: "hello world\nsecond line\n" });
  assert.deepEqual((await m.call("PUT", `${t}/file`, { path: "sub/new.txt", content: "abc" })).body, { ok: true });
  assert.equal(readFileSync(join(code, "sub", "new.txt"), "utf8"), "abc");
  assert.equal((await m.get(`${t}/file?path=../escape`)).status, 400);
});

test("fs creates, renames and validates operations; move relocates", async () => {
  assert.deepEqual((await m.call("POST", `${t}/fs`, { op: "file", path: "a/b.txt" })).body, { path: "a/b.txt" });
  assert.deepEqual((await m.call("POST", `${t}/fs`, { op: "dir", path: "folder" })).body, { path: "folder" });
  assert.deepEqual((await m.call("POST", `${t}/fs`, { op: "rename", path: "a/b.txt", name: "c.txt" })).body, { path: "a/c.txt" });
  assert.deepEqual((await m.call("POST", `${t}/move`, { from: "a/c.txt", toDir: "folder" })).body, { path: "folder/c.txt" });
  const bad = await m.call("POST", `${t}/fs`, { op: "explode" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Unknown operation/);
  assert.equal((await m.call("POST", `${t}/fs`, { op: "file" })).status, 400);
  assert.equal((await m.call("POST", `${t}/fs`, { op: "rename" })).status, 400);
  assert.equal((await m.call("POST", `${t}/fs`)).status, 400);
  assert.equal((await m.call("POST", `${t}/fs`, { op: "delete", path: "ghost" })).status, 404);
});

test("image serves images and reports errors as JSON", async () => {
  const ok = await fetch(`${m.base}${t}/image?path=pic.png`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "not really a png");
  const notImage = await m.get(`${t}/image?path=hello.txt`);
  assert.equal(notImage.status, 415);
  assert.equal((await m.get(`${t}/image?path=gone.png`)).status, 404);
  assert.equal((await m.get(`${t}/image`)).status, 415);
});

test("search finds text and replace rewrites only the listed files", async () => {
  const found = await m.get(`${t}/search?q=HELLO`);
  assert.deepEqual(found.body.hits.map((h: { path: string }) => h.path), ["hello.txt"]);
  assert.equal((await m.get(`${t}/search?q=HELLO&case=1`)).body.hits.length, 0);
  assert.equal((await m.get(`${t}/search?q=hel+lo&word=1`)).body.hits.length, 0);
  assert.equal((await m.get(`${t}/search?q=hel.o&regex=1`)).body.hits.length, 1);
  assert.equal((await m.get(`${t}/search`)).body.hits.length, 0);
  const r = await m.call("POST", `${t}/replace`, { q: "world", replacement: "there", files: ["hello.txt"] });
  assert.deepEqual(r.body, { changed: [{ path: "hello.txt", count: 1 }], total: 1 });
  assert.match(readFileSync(join(code, "hello.txt"), "utf8"), /hello there/);
  assert.equal((await m.call("POST", `${t}/replace`)).status, 400);
});

test("run saves and lists commands per project, and toolchains answers", { skip: process.platform === "win32" ? "needs a bash login shell" : false }, async () => {
  writeFileSync(join(code, "package.json"), JSON.stringify({ scripts: { dev: "x" } }));
  const saved = await m.call("PUT", `${t}/run`, { commands: [{ cmd: "echo hi" }] });
  assert.deepEqual(saved.body, [{ label: "echo hi", cmd: "echo hi" }]);
  assert.deepEqual((await m.get(`${t}/run`)).body.map((c: { cmd: string }) => c.cmd), ["echo hi", "npm run dev"]);
  assert.equal((await m.call("PUT", `${t}/run`, {})).body.length, 0);
  const tools = await m.get(`${t}/toolchains`);
  assert.equal(tools.status, 200);
  assert.ok(tools.body.some((x: { key: string }) => x.key === "git"));
});

test("icons: the manifest and the svg files are served", async () => {
  const manifest = await m.get("/icons/manifest");
  assert.match(manifest.body.file, /\.svg$/);
  const svg = await fetch(`${m.base}/icons/svg/${manifest.body.file}`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get("cache-control") ?? "", /immutable/);
});

test("delete asks the trash and never leaves a half state", async () => {
  writeFileSync(join(code, "del.txt"), "x");
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(env.state, "xdg");
  try {
    const r = await m.call("POST", `${t}/fs`, { op: "delete", path: "del.txt" });
    if (r.status === 200) assert.equal(existsSync(join(code, "del.txt")), false);
    else assert.ok(r.status === 500 && existsSync(join(code, "del.txt")));
  } finally {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
  }
});

test("open-editor validates the path before launching anything", async () => {
  assert.equal((await m.call("POST", `${t}/open-editor`, { path: "../../etc/passwd" })).status, 400);
});
