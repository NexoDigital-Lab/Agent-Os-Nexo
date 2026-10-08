// Create, clone, list remotes and delete, with gh / gio / the nexo CLI replaced by fakes (see fakes.ts) and real git.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempDir, tempEnv } from "../../../host/test/harness.ts";
import { addProjectHooks } from "../server/hooks.ts";
import register from "../server/index.ts";
import { nexo, nexoCommand } from "../server/lifecycle.ts";
import { shimScript } from "../../../host/server/winshell.ts";
import { installFakes } from "./fakes.ts";

const skip = process.platform === "win32" ? "fakes are unix scripts" : false;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

const fakes = skip ? { log: "", trash: "" } : installFakes();
const env = tempEnv();
const m = skip ? null! : await mountModule(register, { env });
const calls = () => (existsSync(fakes.log) ? readFileSync(fakes.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);
const FAKE_VARS = Object.keys({ FAKE_GH_EXISTS: 1, FAKE_GH_VIEW_FAIL: 1, FAKE_GH_URL: 1, FAKE_GH_CREATE_FAIL: 1, FAKE_GH_CREATE_OUT: 1, FAKE_GH_LIST_FAIL: 1, FAKE_GH_LIST: 1, FAKE_GH_DELETE_FAIL: 1, FAKE_GH_USER: 1, FAKE_GH_AUTH: 1, FAKE_GIO_FAIL: 1, FAKE_NEXO_FAIL: 1 });
beforeEach(() => {
  for (const k of FAKE_VARS) delete process.env[k];
  rmSync(fakes.log, { force: true });
});

test("nexo reports a failing CLI as a 500 with its message", { skip }, async () => {
  process.env.FAKE_NEXO_FAIL = "1";
  await assert.rejects(nexo(env, ["new", "x"]), (e: any) => e.status === 500 && /nexo new failed: nexo broke/.test(e.message));
});

test("nexo without NEXO_CLI and no nexo binary on PATH explains how to install it", { skip }, async () => {
  const dev = process.env.NEXO_CLI;
  delete process.env.NEXO_CLI;
  try {
    // findBin only looks in the user bin dirs; if this machine really has nexo there, the call is a real success path.
    await nexo(env, ["--version"]).then(() => undefined, (e: any) => assert.match(e.message, /nexo CLI was not found|nexo --version failed/));
  } finally {
    process.env.NEXO_CLI = dev;
  }
});

test("creating a project validates the name and refuses duplicates", { skip }, async () => {
  assert.equal((await m.call("POST", "/projects", { name: "Bad Name", description: "" })).status, 400);
  assert.equal((await m.call("POST", "/projects", { name: "ok", ws: "bad ws", description: "" })).status, 400);
  assert.equal((await m.call("POST", "/projects", {})).status, 400);
  mkdirSync(join(env.projects, "taken"), { recursive: true });
  const dup = await m.call("POST", "/projects", { name: "taken", description: "" });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already exists/);
});

test("creating a local project writes README and .gitignore and makes the first commit", { skip }, async () => {
  const res = await m.call("POST", "/projects", { name: "alpha", description: "  A tool  ", visibility: "private", remote: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, "alpha");
  assert.equal(res.body.url, null);
  assert.equal(res.body.steps.length, 2);
  const code = join(env.projects, "alpha", "code");
  assert.equal(readFileSync(join(code, "README.md"), "utf8"), "# alpha\n\nA tool\n");
  assert.match(readFileSync(join(code, ".gitignore"), "utf8"), /node_modules\//);
  assert.equal(git(code, "log", "-1", "--format=%s"), "Initial commit");
  assert.equal(git(code, "branch", "--show-current"), "main");
  assert.deepEqual(calls(), [], "no gh call without remote");
  const list = await m.get("/projects");
  assert.ok(list.body.some((p: any) => p.id === "alpha"));
});

test("a project inside a workspace gets its id from ws and a placeholder description", { skip }, async () => {
  const res = await m.call("POST", "/projects", { name: "web", ws: "crm", description: "", visibility: "private", remote: false });
  assert.equal(res.body.id, "crm-ws/web");
  assert.match(readFileSync(join(env.projects, "crm-ws", "web", "code", "README.md"), "utf8"), /_Description pending\._/);
});

test("creating with remote refuses a repository name GitHub already has, before touching disk", { skip }, async () => {
  process.env.FAKE_GH_EXISTS = "1";
  const res = await m.call("POST", "/projects", { name: "beta", description: "", visibility: "public", remote: true });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /already have a "beta" repository/);
  assert.equal(existsSync(join(env.projects, "beta")), false);
});

test("creating with remote runs gh repo create with the visibility and description and returns its url", { skip }, async () => {
  process.env.FAKE_GH_CREATE_OUT = "Created\nhttps://github.com/me/gamma\n";
  const res = await m.call("POST", "/projects", { name: "gamma", description: "G", visibility: "public", remote: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.url, "https://github.com/me/gamma");
  assert.match(res.body.steps.at(-1), /public repository created/);
  const create = calls().find((c) => c[1] === "create")!;
  assert.deepEqual(create, ["repo", "create", "gamma", "--public", "--source", ".", "--remote", "origin", "--push", "--description", "G"]);
});

test("without a url in gh's output the url comes from gh repo view; private by default", { skip }, async () => {
  process.env.FAKE_GH_CREATE_OUT = "done";
  process.env.FAKE_GH_URL = "https://github.com/me/delta";
  const res = await m.call("POST", "/projects", { name: "delta", description: "", visibility: "private", remote: true });
  assert.equal(res.body.url, "https://github.com/me/delta");
  assert.ok(calls().find((c) => c[1] === "create")!.includes("--private"));
});

test("a failing gh repo create is a 500 and the steps so far are kept", { skip }, async () => {
  process.env.FAKE_GH_CREATE_FAIL = "1";
  const res = await m.call("POST", "/projects", { name: "eps", description: "", visibility: "private", remote: true });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /gh repo failed: create refused/);
});

test("a failing nexo new surfaces as 500", { skip }, async () => {
  process.env.FAKE_NEXO_FAIL = "1";
  const res = await m.call("POST", "/projects", { name: "zeta", description: "", visibility: "private", remote: false });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /nexo new failed/);
});

test("listing GitHub repos maps and sorts them, marking the ones already cloned", { skip }, async () => {
  const row = (name: string, pushedAt: string, extra = {}) => ({ name, nameWithOwner: `me/${name}`, description: null, isPrivate: false, isFork: false, isArchived: false, pushedAt, ...extra });
  process.env.FAKE_GH_LIST = JSON.stringify([row("old", "2020-01-01"), row("Alpha", "2024-01-01", { description: "d", isPrivate: true, isFork: true, isArchived: true }), row("new", "2025-01-01")]);
  const res = await m.get("/github/repos");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r: any) => r.name), ["new", "Alpha", "old"]);
  const alpha = res.body[1];
  assert.deepEqual({ ...alpha }, { name: "Alpha", full: "me/Alpha", description: "d", private: true, fork: true, archived: true, pushedAt: "2024-01-01", cloned: true });
  assert.equal(res.body[0].description, "");
  assert.equal(res.body[0].cloned, false);
});

test("a failing gh repo list is a 502", { skip }, async () => {
  process.env.FAKE_GH_LIST_FAIL = "1";
  const res = await m.get("/github/repos");
  assert.equal(res.status, 502);
  assert.match(res.body.error, /gh repo list failed/);
});

test("cloning validates the repository and the target name", { skip }, async () => {
  for (const repo of ["nope", "a/b.git", "", "a b/c"]) assert.equal((await m.call("POST", "/projects/clone", { repo })).status, 400, repo);
  assert.equal((await m.call("POST", "/projects/clone", { repo: "me/ok", name: "Bad Name" })).status, 400);
  assert.equal((await m.call("POST", "/projects/clone", { repo: "me/alpha" })).status, 409, "alpha exists from before");
});

test("cloning calls nexo clone with gh's url, lower-cases the name and reports the branch", { skip }, async () => {
  process.env.FAKE_GH_URL = "https://github.com/me/Theta";
  const res = await m.call("POST", "/projects/clone", { repo: "me/Theta", ws: "lab" });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, "lab-ws/theta");
  assert.equal(res.body.url, "https://github.com/me/Theta");
  assert.match(res.body.steps[0], /projects\/lab-ws\/theta\/code: cloned from me\/Theta \(/);
  assert.ok(existsSync(join(env.projects, "lab-ws", "theta", "AGENTS.md")));
});

test("cloning falls back to the plain https url when gh cannot resolve it, and honours a custom name", { skip }, async () => {
  process.env.FAKE_GH_VIEW_FAIL = "1";
  const res = await m.call("POST", "/projects/clone", { repo: "me/Iota", name: "Custom" });
  assert.equal(res.body.id, "custom");
});

// A project with a real upstream, to read the facts the delete dialog shows.
function repoWithUpstream(id: string) {
  const code = join(env.projects, id, "code");
  mkdirSync(join(env.projects, id, "context"), { recursive: true });
  writeFileSync(join(env.projects, id, "AGENTS.md"), "# x\n");
  writeFileSync(join(env.projects, id, "context", "notes.md"), "n");
  mkdirSync(code, { recursive: true });
  git(code, "init", "-q", "-b", "main");
  writeFileSync(join(code, "a.txt"), "a");
  git(code, "add", "-A");
  git(code, "commit", "-q", "-m", "one");
  const bare = join(tempDir("agent-os-nexo-bare-"), "origin.git");
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git(code, "remote", "add", "origin", bare);
  git(code, "push", "-q", "-u", "origin", "main");
  return code;
}

test("delete-check reads dirty files, unpushed commits, stashes, the GitHub remote and context files", { skip }, async () => {
  const code = repoWithUpstream("kappa");
  writeFileSync(join(code, "b.txt"), "b");
  git(code, "add", "-A");
  git(code, "commit", "-q", "-m", "two");
  writeFileSync(join(code, "a.txt"), "changed");
  git(code, "stash");
  writeFileSync(join(code, "c.txt"), "untracked");
  git(code, "remote", "set-url", "origin", "git@github.com:Me/kappa.git");
  process.env.FAKE_GH_USER = "me";
  process.env.FAKE_GH_AUTH = "Token scopes: 'repo', 'delete_repo'";
  const res = await m.get("/projects/kappa/delete-check");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    id: "kappa", dirty: 1, unpushed: 1, stashes: 1, remote: "Me/kappa", remoteIsMine: true, canDeleteRemote: true,
    worktrees: [], contextFiles: 2, runningTabs: 0, openTabs: 0, container: null,
  });
});

test("delete-check without upstream, remote or gh login reports nulls and false", { skip }, async () => {
  const dir = join(env.projects, "lambda");
  mkdirSync(join(dir, "code"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "x");
  git(join(dir, "code"), "init", "-q", "-b", "main");
  const res = await m.get("/projects/lambda/delete-check");
  assert.equal(res.body.unpushed, null);
  assert.equal(res.body.remote, null);
  assert.equal(res.body.remoteIsMine, false);
  assert.equal(res.body.canDeleteRemote, false);
  assert.equal(res.body.dirty, 0);
  assert.equal((await m.get("/projects/ghost/delete-check")).status, 404);
});

test("a project without code/ still has a delete check", { skip }, async () => {
  const dir = join(env.projects, "mu");
  mkdirSync(join(dir, "context"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "x");
  const res = await m.get("/projects/mu/delete-check");
  assert.equal(res.body.unpushed, null);
  assert.equal(res.body.contextFiles, 1);
});

test("hooks add facts to the delete check and run around a local delete", { skip }, async () => {
  const seen: string[] = [];
  addProjectHooks({ deleteFacts: () => ({ runningTabs: 0, openTabs: 3, container: "dev-nu" }) });
  addProjectHooks({
    beforeLocalDelete: (p) => void seen.push(`before:${p.id}`),
    afterLocalDelete: (p, opts, steps) => void (seen.push(`after:${p.id}:${opts.folder}`), steps.push("hook step")),
  });
  const dir = join(env.projects, "nu");
  mkdirSync(join(dir, "code"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "x");
  const facts = await m.get("/projects/nu/delete-check");
  assert.equal(facts.body.openTabs, 3);
  assert.equal(facts.body.container, "dev-nu");

  const res = await m.call("POST", "/projects/nu/delete", { confirm: "nu", folder: true });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { steps: ["projects/nu → trash", "hook step"], gone: true });
  assert.deepEqual(seen, ["before:nu", "after:nu:true"]);
  assert.equal(existsSync(dir), false);
  assert.equal(readdirSync(fakes.trash).some((n) => n.startsWith("nu-")), true);
});

test("delete validates the confirmation and that something was selected", { skip }, async () => {
  assert.equal((await m.call("POST", "/projects/ghost/delete", { confirm: "ghost", folder: true })).status, 404);
  assert.equal((await m.call("POST", "/projects/lambda/delete", { confirm: "wrong", folder: true })).status, 400);
  const none = await m.call("POST", "/projects/lambda/delete", { confirm: "lambda" });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /Nothing was selected/);
});

test("delete code only trashes code/ and keeps the project folder", { skip }, async () => {
  const res = await m.call("POST", "/projects/mu/delete", { confirm: "mu", code: true });
  assert.equal(res.body.gone, false);
  assert.equal(res.body.steps.some((x: string) => /trash/.test(x)), false, "mu has no code/, so nothing goes to the trash");
  const lam = await m.call("POST", "/projects/lambda/delete", { confirm: "lambda", code: true });
  assert.deepEqual(lam.body.steps.slice(0, 1), ["projects/lambda/code → trash"]);
  assert.ok(existsSync(join(env.projects, "lambda", "AGENTS.md")));
  assert.equal(existsSync(join(env.projects, "lambda", "code")), false);
});

test("delete refuses while tabs are running or worktrees exist", { skip }, async () => {
  const code = repoWithUpstream("xi");
  git(code, "worktree", "add", "-q", "-b", "wt", join(env.projects, "xi", "worktrees", "wt"));
  const blocked = await m.call("POST", "/projects/xi/delete", { confirm: "xi", folder: true });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /worktrees \(wt\)/);
  assert.ok(existsSync(join(env.projects, "xi")));
});

test("running tabs block the delete", { skip }, async () => {
  const dir = join(env.projects, "omicron");
  mkdirSync(join(dir, "code"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "x");
  let busy = true;
  addProjectHooks({ deleteFacts: (p) => (p.id === "omicron" && busy ? { runningTabs: 2 } : {}) });
  const res = await m.call("POST", "/projects/omicron/delete", { confirm: "omicron", folder: true });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /2 tab\(s\) of omicron are working/);
  busy = false;
  assert.equal((await m.call("POST", "/projects/omicron/delete", { confirm: "omicron", folder: true })).status, 200);
});

test("a failing trash is a 500 and nothing is reported as deleted", { skip }, async () => {
  const dir = join(env.projects, "pi");
  mkdirSync(join(dir, "code"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "x");
  process.env.FAKE_GIO_FAIL = "1";
  const res = await m.call("POST", "/projects/pi/delete", { confirm: "pi", folder: true });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /Could not move projects\/pi to the trash/);
  assert.ok(existsSync(dir));
});

function remoteProject(id: string, url: string) {
  const dir = join(env.projects, id);
  mkdirSync(join(dir, "code"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "x");
  git(join(dir, "code"), "init", "-q", "-b", "main");
  if (url) git(join(dir, "code"), "remote", "add", "origin", url);
  return dir;
}

test("deleting the GitHub repo needs an origin, ownership and the delete_repo scope", { skip }, async () => {
  remoteProject("rho", "");
  const noOrigin = await m.call("POST", "/projects/rho/delete", { confirm: "rho", remote: true });
  assert.equal(noOrigin.status, 400);

  remoteProject("sigma", "https://github.com/someone/sigma");
  process.env.FAKE_GH_USER = "me";
  process.env.FAKE_GH_AUTH = "scopes: repo";
  const foreign = await m.call("POST", "/projects/sigma/delete", { confirm: "sigma", remote: true });
  assert.equal(foreign.status, 403);
  assert.match(foreign.body.error, /not in your account/);

  remoteProject("tau", "https://github.com/me/tau.git");
  const noScope = await m.call("POST", "/projects/tau/delete", { confirm: "tau", remote: true });
  assert.equal(noScope.status, 403);
  assert.match(noScope.body.error, /delete_repo/);
});

test("deleting the GitHub repo goes first; a gh failure leaves everything local alone", { skip }, async () => {
  const dir = remoteProject("upsilon", "https://github.com/me/upsilon");
  process.env.FAKE_GH_USER = "me";
  process.env.FAKE_GH_AUTH = "delete_repo";
  process.env.FAKE_GH_DELETE_FAIL = "1";
  const failed = await m.call("POST", "/projects/upsilon/delete", { confirm: "upsilon", remote: true, folder: true });
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /gh repo delete failed/);
  assert.ok(existsSync(dir));

  delete process.env.FAKE_GH_DELETE_FAIL;
  const done = await m.call("POST", "/projects/upsilon/delete", { confirm: "upsilon", remote: true, folder: true });
  assert.deepEqual(done.body.steps.slice(0, 2), ["GitHub: me/upsilon deleted", "projects/upsilon → trash"]);
  assert.ok(calls().some((c) => c.join(" ") === "repo delete me/upsilon --yes"));
});

test("Windows: npm's nexo.cmd shim runs its script with node, never through cmd.exe", () => {
  const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@nexodigital\\nexo\\dist\\bin.js" %*\r\n';
  const js = shimScript("C:\\npm\\nexo.cmd", () => shim);
  assert.equal(js, "C:\\npm\\node_modules\\@nexodigital\\nexo\\dist\\bin.js");
  const dir = "C:\\npm";
  assert.equal(shimScript("x.cmd", () => "@echo off\r\nsomething else\r\n"), null);
  assert.equal(shimScript("missing.cmd", () => { throw new Error("ENOENT"); }), null);

  const dev = process.env.NEXO_CLI;
  delete process.env.NEXO_CLI;
  try {
    const find = ((name: string) => (name === "nexo.cmd" ? `${dir}\\nexo.cmd` : null)) as unknown as Parameters<typeof nexoCommand>[1];
    assert.deepEqual(nexoCommand("win32", find, () => "C:\\npm\\bin.js"), { cmd: process.execPath, pre: ["C:\\npm\\bin.js"], viaCmd: false });
    assert.equal(nexoCommand("win32", find, () => null)?.viaCmd, true, "an unknown shim is the only cmd.exe path");
    assert.equal(nexoCommand("linux", (() => null) as unknown as Parameters<typeof nexoCommand>[1]), null);
  } finally {
    if (dev !== undefined) process.env.NEXO_CLI = dev;
  }
});
