// Source control routes and the commit graph against real git repositories in temporary folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempDir, tempEnv } from "../../../../../host/test/harness.ts";
import { openTab, restoreTabs } from "../../../../sessions/server/agent.ts";
import register from "../server/index.ts";
import { deps } from "../server/scm.ts";
import { commitDetail, commitFileDiff, graph } from "../server/gitgraph.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
const repo = (parent: string, name: string) => {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Tester");
  git(dir, "config", "user.email", "tester@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "pull.rebase", "false");
  return dir;
};
const put = (dir: string, file: string, text: string) => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const commitAll = (dir: string, msg: string) => (git(dir, "add", "-A"), git(dir, "commit", "-q", "-m", msg));

// The real trash needs a desktop (gio): move the file to a temporary folder instead.
const trashed: string[] = [];
const trashDir = tempDir("scm-trash-");
deps.trash = async (abs) => {
  trashed.push(abs);
  renameSync(abs, join(trashDir, String(trashed.length)));
};

const env = tempEnv();
restoreTabs(join(env.state, "tabs.json"));
const root = tempDir("scm-");
const app = await mountModule(register, { env });
const tabFor = (cwd: string) => openTab({ project: "p", dir: cwd, cwd, worktree: null, title: "t" });
const api = (tab: string) => ({
  status: () => app.get(`/tabs/${tab}/scm`),
  post: (op: string, body?: unknown) => app.call("POST", `/tabs/${tab}/scm/${op}`, body ?? {}),
});

// ---------- a repository with a remote ----------
const bare = join(root, "origin.git");
mkdirSync(bare);
git(bare, "init", "-q", "--bare", "-b", "main");
const work = repo(root, "work");
const tab = tabFor(work);
const s = api(tab);

test("status of a repo with no commits: untracked files and no HEAD", async () => {
  put(work, "a.txt", "one\n");
  const r = await s.status();
  assert.equal(r.status, 200);
  assert.equal(r.body.branch, "main");
  assert.equal(r.body.hasCommits, false);
  assert.deepEqual(r.body.untracked.map((c: any) => c.path), ["a.txt"]);
  assert.equal(r.body.merging, false);
});

test("stage, unstage before the first commit, then stage all", async () => {
  let r = await s.post("stage", { paths: ["a.txt"] });
  assert.deepEqual(r.body.staged.map((c: any) => [c.path, c.label]), [["a.txt", "new"]]);
  r = await s.post("unstage", { paths: ["a.txt"] });
  assert.equal(r.body.staged.length, 0);
  assert.equal(r.body.untracked.length, 1);
  r = await s.post("stage", { paths: "all" });
  assert.equal(r.body.staged.length, 1);
  r = await s.post("unstage", { paths: "all" });
  assert.equal(r.body.staged.length, 0);
});

test("stage and unstage validate their paths", async () => {
  assert.equal((await s.post("stage", {})).status, 400);
  assert.equal((await s.post("stage", { paths: [] })).status, 400);
  assert.equal((await s.post("stage", { paths: ["../escape.txt"] })).status, 400);
  assert.equal((await s.post("unstage", { paths: "all" })).status, 200, "nothing staged is not an error");
});

test("commit needs a message, commits with -a style stage and can amend", async () => {
  assert.equal((await s.post("commit", { message: "  " })).status, 400);
  let r = await s.post("commit", { message: "first", all: true });
  assert.equal(r.body.hasCommits, true);
  assert.equal(git(work, "log", "-1", "--format=%s").trim(), "first");
  put(work, "a.txt", "one\ntwo\n");
  r = await s.post("commit", { message: "renamed", amend: true, all: true });
  assert.equal(git(work, "log", "--format=%s").trim(), "renamed");
  await s.post("commit", { amend: true });
  assert.equal(git(work, "log", "--format=%s").trim(), "renamed", "amend without a message keeps it");
  assert.equal(git(work, "show", "HEAD:a.txt"), "one\ntwo\n");
});

test("a failing git command is a 500 carrying git's message", async () => {
  const r = await s.post("commit", { message: "nothing to commit" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /^git commit:/);
});

test("modified, renamed and deleted files get their labels", async () => {
  put(work, "b.txt", "bee\n");
  put(work, "c.txt", "see\n");
  commitAll(work, "more");
  put(work, "a.txt", "changed\n");
  git(work, "mv", "b.txt", "b2.txt");
  git(work, "rm", "-q", "c.txt");
  const r = (await s.status()).body;
  assert.deepEqual(r.unstaged.map((c: any) => [c.path, c.label]), [["a.txt", "modified"]]);
  const staged = Object.fromEntries(r.staged.map((c: any) => [c.path, c]));
  assert.equal(staged["b2.txt"].label, "renamed");
  assert.equal(staged["b2.txt"].from, "b.txt");
  assert.equal(staged["c.txt"].label, "deleted");
  await s.post("commit", { message: "tidy", all: true });
});

test("discard restores tracked files and moves untracked ones to the trash", async () => {
  put(work, "a.txt", "scribble\n");
  put(work, "junk.txt", "junk\n");
  const r = await s.post("discard", { paths: ["a.txt", "junk.txt"] });
  assert.equal(r.status, 200);
  assert.equal(readFileSync(join(work, "a.txt"), "utf8"), "changed\n");
  assert.ok(!existsSync(join(work, "junk.txt")));
  assert.deepEqual(trashed, [join(work, "junk.txt")]);
  assert.equal(r.body.untracked.length, 0);
  assert.equal((await s.post("discard", {})).status, 400);
});

test("file diff gives both sides, staged or not, and refuses paths outside the repo", async () => {
  put(work, "a.txt", "worktree\n");
  let r = await app.get(`/tabs/${tab}/scm/diff?path=a.txt`);
  assert.deepEqual(r.body, { original: "changed\n", modified: "worktree\n" });
  git(work, "add", "a.txt");
  r = await app.get(`/tabs/${tab}/scm/diff?path=a.txt&staged=1`);
  assert.deepEqual(r.body, { original: "changed\n", modified: "worktree\n" });
  r = await app.get(`/tabs/${tab}/scm/diff?path=new-file.txt`);
  assert.deepEqual(r.body, { original: "", modified: "" });
  assert.equal((await app.get(`/tabs/${tab}/scm/diff?path=../x`)).status, 400);
  put(work, "a.txt", "changed\n");
  git(work, "add", "a.txt");
  await s.post("unstage", { paths: ["a.txt"] });
  put(work, "gone.txt", "x\n");
  commitAll(work, "gone");
  git(work, "rm", "-q", "--cached", "gone.txt");
  r = await app.get(`/tabs/${tab}/scm/diff?path=gone.txt`);
  assert.equal(r.body.original, "x\n");
  git(work, "reset", "-q", "--hard");
});

test("branches: create, list, switch and reject bad names", async () => {
  assert.equal((await s.post("checkout", { name: "-bad" })).status, 400);
  assert.equal((await s.post("checkout", { name: "has space" })).status, 400);
  let r = await s.post("checkout", { name: "feat/x", create: true });
  assert.equal(r.body.branch, "feat/x");
  const list = (await app.get(`/tabs/${tab}/scm/branches`)).body;
  assert.deepEqual(list.filter((b: any) => b.current).map((b: any) => b.name), ["feat/x"]);
  assert.ok(list.find((b: any) => b.name === "main"));
  r = await s.post("checkout", { name: "main" });
  assert.equal(r.body.branch, "main");
});

test("push sets the upstream, fetch and pull follow it, ahead/behind are reported", async () => {
  git(work, "remote", "add", "origin", bare);
  let r = await s.post("sync/push");
  assert.equal(r.status, 200);
  assert.equal(r.body.upstream, "origin/main");
  put(work, "p.txt", "p\n");
  commitAll(work, "local only");
  assert.equal((await s.status()).body.ahead, 1);
  r = await s.post("sync/push");
  assert.equal(r.body.ahead, 0);

  const other = join(root, "other");
  git(root, "clone", "-q", bare, other);
  git(other, "config", "user.name", "Other");
  git(other, "config", "user.email", "other@example.com");
  git(other, "config", "commit.gpgsign", "false");
  put(other, "o.txt", "o\n");
  commitAll(other, "from other");
  git(other, "push", "-q");
  r = await s.post("sync/fetch");
  assert.equal(r.body.behind, 1);
  r = await s.post("sync/pull");
  assert.equal(r.body.behind, 0);
  assert.ok(existsSync(join(work, "o.txt")));
  const names = (await app.get(`/tabs/${tab}/scm/branches`)).body.map((b: any) => b.name);
  assert.ok(names.includes("origin/main"));
  assert.ok(!names.includes("origin"));
  assert.equal((await s.post("sync/rebase")).status, 400);
});

test("checking out a remote-only branch tracks it", async () => {
  const other = join(root, "other");
  git(other, "switch", "-q", "-c", "remote-only");
  put(other, "r.txt", "r\n");
  commitAll(other, "remote branch");
  git(other, "push", "-q", "-u", "origin", "remote-only");
  await s.post("sync/fetch");
  const r = await s.post("checkout", { name: "origin/remote-only" });
  assert.equal(r.status, 200);
  assert.equal(r.body.branch, "remote-only");
  assert.equal(r.body.upstream, "origin/remote-only");
  await s.post("checkout", { name: "main" });
});

test("stash push, apply, pop and drop, and unknown operations are refused", async () => {
  put(work, "a.txt", "stash me\n");
  put(work, "fresh.txt", "untracked\n");
  let r = await s.post("stash", { op: "push", message: "wip" });
  assert.equal(r.body.stashes.length, 1);
  assert.match(r.body.stashes[0].message, /wip/);
  assert.ok(!existsSync(join(work, "fresh.txt")), "untracked files are stashed too");
  r = await s.post("stash", { op: "apply", index: 0 });
  assert.equal(readFileSync(join(work, "a.txt"), "utf8"), "stash me\n");
  await s.post("discard", { paths: ["a.txt", "fresh.txt"] });
  r = await s.post("stash", { op: "pop" });
  assert.equal(r.body.stashes.length, 0);
  await s.post("stash", { op: "push" });
  r = await s.post("stash", { op: "drop", index: 0 });
  assert.equal(r.body.stashes.length, 0);
  assert.equal((await s.post("stash", { op: "explode" })).status, 400);
  await s.post("discard", { paths: ["a.txt"] }).catch(() => null);
});

// ---------- merge conflicts ----------
function conflictRepo() {
  const dir = repo(root, `conflict-${Math.random().toString(36).slice(2, 8)}`);
  put(dir, "f.txt", "base\n");
  commitAll(dir, "base");
  git(dir, "switch", "-q", "-c", "side");
  put(dir, "f.txt", "side\n");
  commitAll(dir, "side");
  git(dir, "switch", "-q", "main");
  put(dir, "f.txt", "main\n");
  commitAll(dir, "main");
  assert.throws(() => git(dir, "merge", "side"));
  return dir;
}

test("a merge in progress shows its conflicts; ours and theirs resolve them", async () => {
  const dir = conflictRepo();
  const c = api(tabFor(dir));
  let r = (await c.status()).body;
  assert.equal(r.merging, true);
  assert.deepEqual(r.conflicts.map((x: any) => x.path), ["f.txt"]);
  r = (await c.post("resolve", { path: "f.txt", side: "theirs" })).body;
  assert.equal(r.conflicts.length, 0);
  assert.equal(readFileSync(join(dir, "f.txt"), "utf8"), "side\n");
  assert.equal(r.merging, true);
  git(dir, "commit", "-q", "--no-edit");
  assert.equal((await c.status()).body.merging, false);
});

test("manual resolution is refused while markers remain, accepted once removed; ours keeps our side", async () => {
  const dir = conflictRepo();
  const c = api(tabFor(dir));
  const refused = await c.post("resolve", { path: "f.txt", side: "manual" });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /markers/);
  put(dir, "f.txt", "both\n");
  assert.equal((await c.post("resolve", { path: "f.txt", side: "manual" })).body.conflicts.length, 0);
  git(dir, "merge", "--abort");
  const dir2 = conflictRepo();
  const c2 = api(tabFor(dir2));
  await c2.post("resolve", { path: "f.txt", side: "ours" });
  assert.equal(readFileSync(join(dir2, "f.txt"), "utf8"), "main\n");
  assert.notEqual((await c2.post("resolve", {})).status, 200, "a resolve without a path fails");
});

test("abort merge leaves the repository clean", async () => {
  const dir = conflictRepo();
  const c = api(tabFor(dir));
  const r = (await c.post("abort-merge")).body;
  assert.equal(r.merging, false);
  assert.equal(r.conflicts.length, 0);
  assert.equal((await c.post("abort-merge")).status, 500, "no merge to abort");
});

test("a detached HEAD has no branch", async () => {
  const dir = repo(root, "detached");
  put(dir, "d.txt", "d\n");
  commitAll(dir, "d");
  git(dir, "checkout", "-q", "--detach");
  assert.equal((await api(tabFor(dir)).status()).body.branch, null);
});

test("routes of an unknown tab are 404", async () => {
  assert.equal((await app.get("/tabs/nope/scm")).status, 404);
  assert.equal((await app.get("/tabs/nope/git/graph")).status, 404);
});

// ---------- graph ----------
test("graph lists commits newest first with refs, parents and the current branch", async () => {
  const g = (await app.get(`/tabs/${tab}/git/graph`)).body;
  assert.equal(g.branch, "main");
  assert.ok(g.commits.length >= 6);
  const head = g.commits.find((c: any) => c.refs.some((r: any) => r.kind === "head"));
  assert.ok(head.refs.some((r: any) => r.name === "main"));
  assert.ok(g.commits.some((c: any) => c.refs.some((r: any) => r.kind === "remote" && r.name === "origin/main")));
  assert.ok(g.commits.some((c: any) => c.refs.some((r: any) => r.kind === "local" && r.name === "feat/x")));
  const root0 = g.commits.at(-1);
  assert.deepEqual(root0.parents, []);
  assert.ok(Number.isFinite(root0.time) && root0.time > 0);
  assert.equal(root0.author, "Tester");
});

test("graph decorates tags, outside a repo it is a 400, in an empty repo it is empty", async () => {
  const dir = repo(root, "tags");
  const empty = await graph(dir, 100, true);
  assert.deepEqual(empty, { branch: "main", commits: [] });
  put(dir, "t.txt", "t\n");
  commitAll(dir, "tagged");
  git(dir, "tag", "v1");
  const g = await graph(dir, 1, true);
  assert.deepEqual(g.commits[0].refs.map((r) => [r.kind, r.name]).sort(), [["head", "main"], ["tag", "v1"]]);
  git(dir, "switch", "-q", "-c", "side");
  put(dir, "s.txt", "s\n");
  commitAll(dir, "only on side");
  git(dir, "switch", "-q", "main");
  assert.ok((await graph(dir, 100, true)).commits.some((c) => c.subject === "only on side"));
  assert.ok(!(await graph(dir, 100, false)).commits.some((c) => c.subject === "only on side"));
  const plain = tempDir("not-a-repo-");
  await assert.rejects(graph(plain, 100, true), /not in a git repository/);
});

test("commit detail lists files with line counts and binaries; file diff shows one file", async () => {
  const dir = repo(root, "detail");
  put(dir, "keep.txt", "k\n");
  commitAll(dir, "base");
  put(dir, "keep.txt", "k\nk2\nk3\n");
  put(dir, "sub/new file.txt", "n\n");
  writeFileSync(join(dir, "img.bin"), Buffer.from([0, 255, 0, 1]));
  commitAll(dir, "subject line\n\nlong body here");
  const hash = git(dir, "rev-parse", "HEAD").trim();
  const d = await commitDetail(dir, hash.slice(0, 8));
  assert.equal(d.hash, hash);
  assert.equal(d.author, "Tester");
  assert.equal(d.email, "tester@example.com");
  assert.equal(d.body, "subject line\n\nlong body here");
  const files = Object.fromEntries(d.files.map((f) => [f.file, f]));
  assert.deepEqual([files["keep.txt"].add, files["keep.txt"].del, files["keep.txt"].binary], [2, 0, false]);
  assert.equal(files["img.bin"].binary, true);
  assert.ok(files["sub/new file.txt"]);

  const viaRoute = await app.get(`/tabs/${tabFor(dir)}/git/commit/${hash}`);
  assert.equal(viaRoute.body.hash, hash);
  const diff = await app.get(`/tabs/${tabFor(dir)}/git/diff?hash=${hash}&file=keep.txt`);
  assert.match(diff.body.diff, /\+k3/);
});

test("hashes are validated and a huge diff is truncated", async () => {
  const dir = repo(root, "big");
  put(dir, "big.txt", "x".repeat(10) + "\n");
  commitAll(dir, "small");
  put(dir, "big.txt", ("line of text that repeats\n").repeat(20_000));
  commitAll(dir, "big");
  const hash = git(dir, "rev-parse", "HEAD").trim();
  const out = await commitFileDiff(dir, hash, "big.txt");
  assert.match(out.diff, /… \(diff truncado\)$/);
  assert.ok(out.diff.length < 400_100);
  await assert.rejects(commitDetail(dir, "zz"), (e: any) => e.status === 400);
  await assert.rejects(commitFileDiff(dir, "--help", "x"), (e: any) => e.status === 400);
  assert.equal((await app.get(`/tabs/${tabFor(dir)}/git/commit/nothex`)).status, 400);
  assert.equal((await app.get(`/tabs/${tabFor(dir)}/git/diff?hash=&file=a`)).status, 400);
});
