// The projects routes over real HTTP: listing, diff, and the features API with its validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import register, { dirOf, repo } from "../server/index.ts";
import { installFakes } from "./fakes.ts";

const skipFakes = process.platform === "win32" ? "the fake trash is a unix script" : false;
if (!skipFakes) installFakes();
const env = tempEnv();
const code = join(env.projects, "app", "code");
mkdirSync(code, { recursive: true });
mkdirSync(join(env.projects, "app", "context"), { recursive: true });
writeFileSync(join(env.projects, "app", "AGENTS.md"), "# app\n");
const git = (...args: string[]) => execFileSync("git", args, { cwd: code, stdio: "pipe" }).toString();
git("init", "-q", "-b", "main");
writeFileSync(join(code, "a.txt"), "one\n");
git("add", "-A");
git("-c", "user.name=T", "-c", "user.email=t@e.st", "commit", "-q", "-m", "first");
mkdirSync(join(env.projects, "bare"), { recursive: true });
writeFileSync(join(env.projects, "bare", "AGENTS.md"), "# bare\n"); // no code/ yet
const m = await mountModule(register, { env });

test("GET /projects lists the environment's projects", async () => {
  const res = await m.get("/projects");
  assert.deepEqual(res.body.map((p: any) => p.id), ["app", "bare"]);
  assert.equal(res.body[0].lastCommit.subject, "first");
});

test("dirOf and repo throw 404 for unknown projects, and repo for one without code/", () => {
  assert.equal(dirOf("app"), join(env.projects, "app"));
  assert.equal(repo("app"), code);
  assert.throws(() => dirOf("ghost"), (e: any) => e.status === 404);
  assert.throws(() => repo("bare"), (e: any) => e.status === 404 && /no code\/ yet/.test(e.message));
});

test("GET /projects/:id/diff reports changed, untracked files and recent commits", async () => {
  writeFileSync(join(code, "a.txt"), "one\ntwo\n");
  writeFileSync(join(code, "new.txt"), "n");
  const res = await m.get("/projects/app/diff");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.files, [{ file: "a.txt", add: 1, del: 0 }]);
  assert.deepEqual(res.body.untracked, ["new.txt"]);
  assert.match(res.body.diff, /\+two/);
  assert.equal(res.body.commits[0].subject, "first");
  assert.equal((await m.get("/projects/bare/diff")).status, 404);
});

test("the diff is truncated past 400 KB", async () => {
  writeFileSync(join(code, "big.txt"), "x".repeat(500 * 1024));
  git("add", "big.txt");
  const res = await m.get("/projects/app/diff");
  assert.match(res.body.diff, /… \(diff truncated\)$/);
  git("reset", "-q", "big.txt");
});

test("features: create, list, read, patch and validation errors", async () => {
  const bad = (body: unknown) => m.call("POST", "/projects/app/features", body);
  assert.equal((await bad({ title: "  ", type: "feature", size: "S" })).status, 400);
  assert.equal((await bad(undefined)).status, 400);
  assert.equal((await bad({ title: "t", type: "nope", size: "S" })).status, 400);
  assert.equal((await bad({ title: "t", type: "feature", size: "XXL" })).status, 400);
  assert.match((await bad({ title: "t", type: "feature", size: "S", priority: "P9" })).body.error, /priority/);
  assert.match((await bad({ title: "t", type: "feature", size: "S", status: "wat" })).body.error, /status/);
  assert.match((await bad({ title: "x".repeat(201), type: "feature", size: "S" })).body.error, /200 characters/);
  assert.match((await bad({ title: "t", type: "feature", size: "S", criteria: "no" })).body.error, /criteria/);
  assert.match((await bad({ title: "t", type: "feature", size: "S", files: Array(51).fill("a") })).body.error, /files/);
  assert.match((await bad({ title: "t", type: "feature", size: "S", files: [1] })).body.error, /files/);
  assert.match((await bad({ title: "t", type: "feature", size: "S", criteria: ["x".repeat(501)] })).body.error, /criteria/);
  assert.equal((await m.call("POST", "/projects/ghost/features", { title: "t", type: "feature", size: "S" })).status, 404);

  const created = await bad({ title: "Add search", type: "feature", size: "M", criteria: ["Finds"], files: ["a.ts"], priority: "P1", status: "todo" });
  assert.equal(created.status, 200);
  const slug = created.body.slug as string;
  assert.equal(slug, "0001-add-search");

  const list = await m.get("/projects/app/features");
  assert.equal(list.body[0].title, "Add search");
  assert.equal(list.body[0].priority, "P1");
  assert.match((await m.get(`/projects/app/features/${slug}`)).body.markdown, /Finds/);
  assert.equal((await m.get("/projects/app/features/0099-missing")).status, 404);
  assert.equal((await m.get("/projects/app/features/..%2F..%2FAGENTS")).status, 404);

  const patch = (body: unknown, s = slug) => m.call("PATCH", `/projects/app/features/${s}`, body);
  assert.equal((await patch({ status: "doing", priority: "P0" })).status, 200);
  const after = (await m.get("/projects/app/features")).body[0];
  assert.equal(after.status, "doing");
  assert.equal(after.priority, "P0");
  assert.equal((await patch({})).status, 400);
  assert.equal((await patch({ status: "bogus" })).status, 400);
  assert.equal((await patch({ priority: "P7" })).status, 400);
  assert.equal((await patch({ status: "done" }, "0099-missing")).status, 404);
});

test("deleting a feature sends its file to the trash; unknown ones are 404", { skip: skipFakes }, async () => {
  const slug = (await m.call("POST", "/projects/app/features", { title: "Remove me", type: "bug", size: "S" })).body.slug as string;
  const file = join(env.projects, "app", "context", "features", `${slug}.md`);
  assert.ok(existsSync(file));
  assert.equal((await m.call("DELETE", `/projects/app/features/${slug}`)).status, 200);
  assert.equal(existsSync(file), false);
  assert.equal((await m.call("DELETE", `/projects/app/features/${slug}`)).status, 404);
  assert.equal((await m.call("DELETE", "/projects/ghost/features/x")).status, 404);
});
