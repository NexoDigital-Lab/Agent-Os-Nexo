// The setup wizard: stack detection (recipes), the plan/apply split, .env merging and the command chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../../../host/test/harness.ts";
import { initExtensions } from "../../../../extensions/server/extensions.ts";
import { initProjects } from "../../../../projects/server/projects.ts";
import { openTab, restoreTabs } from "../../../../sessions/server/agent.ts";
import register from "../server/index.ts";
import { RECIPES } from "../server/recipes.ts";
import { analyze, applySetup, deps, planSetup } from "../server/setup.ts";

const env = tempEnv();
initProjects(env);
initExtensions(env);
restoreTabs(join(env.state, "tabs.json"));
let lookups = 0;
deps.githubLogin = async () => (lookups++, "octo");
const app = await mountModule(register, { env });

/** A project folder (AGENTS.md + a git repo in code/) with the given files. */
let n = 0;
function project(files: Record<string, string>, agents = "# p\n") {
  const id = `proj${++n}`;
  const dir = join(env.projects, id);
  const code = join(dir, "code");
  mkdirSync(code, { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), agents);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: code });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(code, f, ".."), { recursive: true });
    writeFileSync(join(code, f), text);
  }
  return { id, dir, code };
}
const pkg = (deps: Record<string, string> = {}) => JSON.stringify({ dependencies: deps });
const detectedIds = async (files: Record<string, string>) => {
  const p = project(files);
  return (await analyze(p.id, p.code)).detected.map((d) => d.id);
};

test("an empty repo (only README/.gitignore) detects nothing and offers every recipe with its questions", async () => {
  const p = project({ "README.md": "# hi\n", ".gitignore": "x\n" });
  const a = await analyze(p.id, p.code);
  assert.equal(a.empty, true);
  assert.deepEqual(a.detected, []);
  assert.deepEqual(a.recipes.map((r) => r.id), RECIPES.map((r) => r.id));
  const go = a.recipes.find((r) => r.id === "go")!;
  assert.equal(go.scaffold, true);
  assert.equal(go.questions[0].default, `github.com/octo/${p.id}`);
  assert.equal(a.recipes.find((r) => r.id === "nest")!.questions.length, 0);
  assert.deepEqual(a.deps, []);
  assert.deepEqual(a.env, { file: null, keys: [], hasEnv: false });
  assert.ok(a.toolchains.some((t) => t.key === "git"));
  await analyze(p.id, p.code);
  assert.equal(lookups, 1, "the GitHub login is looked up once");
});

test("stacks are recognised from their files, and a specific stack hides its generic parent", async () => {
  assert.deepEqual(await detectedIds({ "go.mod": "module x\n" }), ["go"]);
  assert.deepEqual(await detectedIds({ "main.go": "package main\n" }), ["go"]);
  assert.deepEqual(await detectedIds({ "package.json": pkg({ "@nestjs/core": "1" }) }), ["nest"]);
  assert.deepEqual(await detectedIds({ "package.json": pkg({ next: "1" }) }), ["next"]);
  assert.deepEqual(await detectedIds({ "package.json": JSON.stringify({ devDependencies: { react: "1", vite: "1" } }) }), ["react-vite"]);
  assert.deepEqual(await detectedIds({ "package.json": pkg({ left: "1" }) }), ["node-ts"]);
  assert.deepEqual(await detectedIds({ "requirements.txt": "FastAPI\n" }), ["fastapi"]);
  assert.deepEqual(await detectedIds({ "pyproject.toml": "[project]\ndependencies=['fastapi']\n" }), ["fastapi"]);
  assert.deepEqual(await detectedIds({ "requirements.txt": "requests\n" }), ["python"]);
  assert.deepEqual(await detectedIds({ "tool.py": "print(1)\n" }), ["python"]);
  assert.deepEqual(await detectedIds({ "index.html": "<html>\n" }), ["static"]);
  assert.deepEqual(await detectedIds({ "index.html": "<html>\n", "package.json": pkg() }), ["node-ts"], "html with a package.json is not a static site");
});

test("dependency commands depend on the package manager, node_modules and the .venv", async () => {
  const depsOf = async (files: Record<string, string>, after?: (code: string) => void) => {
    const p = project(files);
    after?.(p.code);
    return (await analyze(p.id, p.code)).deps.map((d) => d.cmd);
  };
  assert.deepEqual(await depsOf({ "package.json": pkg() }), ["npm install"]);
  assert.deepEqual(await depsOf({ "package.json": pkg(), "pnpm-lock.yaml": "" }), ["pnpm install"]);
  assert.deepEqual(await depsOf({ "package.json": pkg(), "yarn.lock": "" }), ["yarn install"]);
  assert.deepEqual(await depsOf({ "package.json": pkg() }, (c) => mkdirSync(join(c, "node_modules"))), []);
  assert.deepEqual(await depsOf({ "go.mod": "module x\n" }), ["go mod download"]);
  assert.deepEqual(await depsOf({ "requirements.txt": "requests\n" }), ["python3 -m venv .venv", ".venv/bin/pip install -r requirements.txt"]);
  assert.deepEqual(await depsOf({ "requirements.txt": "requests\n" }, (c) => mkdirSync(join(c, ".venv"))), [".venv/bin/pip install -r requirements.txt"]);
  assert.deepEqual(await depsOf({ "pyproject.toml": "[project]\n" }, (c) => mkdirSync(join(c, ".venv"))), [".venv/bin/pip install -e ."]);
  assert.deepEqual(await depsOf({ "tool.py": "x\n" }), [], "a lone script has nothing to install");
});

test("analyze reads the .env example against the current .env, extensions and the thin-context flag", async () => {
  const p = project({
    ".env.example": "# the database\nDB_URL=\"postgres://x\"\nPLAIN=1\n\nnot a pair\n# lost comment\nEMPTY=\n",
    ".env": "DB_URL=local\n",
    "go.mod": "module x\n",
  }, "<!-- filled by nexo-onboard: pending -->\n");
  const a = await analyze(p.id, p.code);
  assert.equal(a.env.file, ".env.example");
  assert.equal(a.env.hasEnv, true);
  assert.deepEqual(a.env.keys, [
    { key: "DB_URL", value: "postgres://x", comment: "the database", current: "local" },
    { key: "PLAIN", value: "1", comment: "", current: null },
    { key: "EMPTY", value: "", comment: "lost comment", current: null },
  ]);
  assert.equal(a.contextThin, true);
  assert.ok(a.extensions.recommended.every((r) => r.source === "rules"));
  assert.ok(a.extensions.recommended.some((r) => r.id === "golang.go"));
  assert.deepEqual(a.run.map((r) => r.source), a.run.map(() => "detected"));
  writeFileSync(join(p.dir, "AGENTS.md"), "# Real content\n");
  assert.equal((await analyze(p.id, p.code)).contextThin, false);
});

test("plan: an unknown recipe is a 400 and an empty request plans nothing", async () => {
  const p = project({ "README.md": "x\n" });
  await assert.rejects(planSetup(p.id, p.code, { recipe: "cobol" }), (e: any) => e.status === 400 && /Unknown recipe/.test(e.message));
  assert.deepEqual(await planSetup(p.id, p.code, {}), { writes: [], commands: [] });
});

test("plan of a Go template lists its files, commands and .gitignore entries, and never overwrites", async () => {
  const p = project({ "main.go": "package mine\n", ".gitignore": "*.exe\n" });
  const plan = await planSetup(p.id, p.code, { recipe: "go", answers: { module: "ex.com/m b!", kind: "cli" } });
  assert.deepEqual(plan.writes, [{ path: ".gitignore", what: "adds /bin/" }], "main.go exists and *.exe is already ignored");
  assert.deepEqual(plan.commands, [{ label: "Template: Go", cmd: "go mod init ex.com/mb" }]);
  writeFileSync(join(p.code, "go.mod"), "module x\n");
  assert.deepEqual((await planSetup(p.id, p.code, { recipe: "go", answers: { module: "m" } })).commands, [], "go mod init is skipped when go.mod exists");
});

test("apply writes template files once, appends .gitignore and returns a chain that stops at the first failure", async () => {
  const p = project({ ".gitignore": "keep" });
  const r = await applySetup(p.id, p.code, { recipe: "static", answers: {}, env: {} });
  assert.deepEqual(r.writes.map((w) => w.path), ["index.html", "style.css", "script.js"]);
  assert.equal(r.chain, null);
  assert.match(readFileSync(join(p.code, "index.html"), "utf8"), new RegExp(`<title>${p.id}</title>`));

  const g = await applySetup(p.id, p.code, { recipe: "node-ts", answers: {} });
  assert.equal(readFileSync(join(p.code, "src", "index.ts"), "utf8"), `console.log("hello from TypeScript");\n`);
  assert.equal(readFileSync(join(p.code, ".gitignore"), "utf8"), "keep\nnode_modules/\ndist/\n", "adds the missing newline first");
  assert.equal(g.commands.length, 4);
  assert.equal(g.chain!.split("\\033[1;33m").length - 1, 4, "one announcement per command");
  assert.match(g.chain!, /\[1\/4\] %s.*npm init -y/);
  assert.match(g.chain!, /✔ Setup done/);
  const again = await planSetup(p.id, p.code, { recipe: "node-ts" });
  assert.ok(!again.writes.some((w) => w.path === "src/index.ts"));
  assert.ok(!again.writes.some((w) => w.path === ".gitignore"), "nothing new to ignore");
});

test("only dependency commands that analyze offered are accepted", async () => {
  const p = project({ "package.json": pkg() });
  const plan = await planSetup(p.id, p.code, { deps: ["npm install", "rm -rf /", "npm install"] });
  assert.deepEqual(plan.commands, [{ label: "Install Node dependencies", cmd: "npm install" }]);
  const empty = project({ "README.md": "x\n" });
  assert.deepEqual((await planSetup(empty.id, empty.code, { deps: ["npm install"] })).commands, []);
});

test("toolchains to install come in prerequisite order, only the missing ones", async () => {
  const p = project({ "go.mod": "module x\n" });
  const tools = (await analyze(p.id, p.code)).toolchains;
  const plan = await planSetup(p.id, p.code, { toolchains: ["gopls", "bogus", "go", "git", "node"] });
  const order = ["git", "go", "node", "python", "docker", "gopls"];
  const expected = tools
    .filter((t) => ["gopls", "go", "git", "node"].includes(t.key) && !t.installed && t.install)
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .map((t) => `Install ${t.name}`);
  assert.deepEqual(plan.commands.map((c) => c.label), expected);
});

test(".env values are merged in place, quoted when needed, and .env is gitignored unless already", async () => {
  const p = project({ ".env": "# keep me\nexport A=old\nB=untouched\n" });
  const plan = await planSetup(p.id, p.code, { env: { A: "new value", C: "plain", "bad key": "x", D: "line1\nline2" } });
  assert.deepEqual(plan.writes, [{ path: ".env", what: "4 variable(s)" }, { path: ".gitignore", what: "adds .env" }]);
  await applySetup(p.id, p.code, { env: { A: "new value", C: "plain", "bad key": "x", D: "line1\nline2", E: "it's #1" } });
  assert.equal(readFileSync(join(p.code, ".env"), "utf8"), '# keep me\nexport A="new value"\nB=untouched\nC=plain\nD="line1 line2"\nE="it\'s #1"\n');
  assert.equal(readFileSync(join(p.code, ".gitignore"), "utf8"), ".env\n");
  const again = await planSetup(p.id, p.code, { env: { A: "x" } });
  assert.deepEqual(again.writes, [{ path: ".env", what: "1 variable(s)" }], "already ignored");
  const fresh = project({});
  await applySetup(fresh.id, fresh.code, { env: { Z: "1" } });
  assert.equal(readFileSync(join(fresh.code, ".env"), "utf8"), "Z=1\n");
});

test("extensions, .vscode, VS Code installs and run commands are planned and applied", async () => {
  const p = project({ "go.mod": "module x\n" });
  const body = { recipe: "go", answers: { module: "m" }, extensions: ["golang.go", "agent-os-nexo.next", "bad id; rm"], installExtensions: true, writeVscode: true, addRun: true };
  const plan = await planSetup(p.id, p.code, body);
  assert.deepEqual(plan.writes.map((w) => w.path).sort(), [".gitignore", ".vscode/extensions.json", "context/extensions.json", "context/run.json", "main.go"]);
  assert.deepEqual(plan.commands.filter((c) => c.label.startsWith("VS Code")), [{ label: "VS Code: golang.go", cmd: "code --install-extension golang.go" }]);

  await applySetup(p.id, p.code, body);
  const ext = JSON.parse(readFileSync(join(p.dir, "context", "extensions.json"), "utf8"));
  assert.ok(ext.extensions.includes("golang.go"));
  assert.ok(!ext.extensions.some((e: string) => e.includes(" ")), "invalid ids are dropped");
  assert.ok(JSON.parse(readFileSync(join(p.code, ".vscode", "extensions.json"), "utf8")).recommendations.includes("golang.go"));
  const run = JSON.parse(readFileSync(join(p.dir, "context", "run.json"), "utf8")).commands;
  assert.deepEqual(run.map((r: any) => r.cmd), ["go run .", "go test ./..."]);

  await applySetup(p.id, p.code, { addRun: true, recipe: "go", answers: { module: "m" }, extensions: ["golang.go"] });
  assert.equal(JSON.parse(readFileSync(join(p.dir, "context", "run.json"), "utf8")).commands.length, 2, "no duplicates on a second apply");
  assert.equal(JSON.parse(readFileSync(join(p.dir, "context", "extensions.json"), "utf8")).extensions.filter((e: string) => e === "golang.go").length, 1);
});

test("writeVscode on a repo whose .vscode/extensions.json is invalid does not break apply", async () => {
  const p = project({ ".vscode/extensions.json": "{ nope" });
  const r = await applySetup(p.id, p.code, { writeVscode: true });
  assert.deepEqual(r.writes.map((w) => w.path), [".vscode/extensions.json"]);
  assert.equal(readFileSync(join(p.code, ".vscode", "extensions.json"), "utf8"), "{ nope");
});

test("each command is announced by a quoted printf and the chain ends with the done marker", async () => {
  const p = project({});
  const r = await applySetup(p.id, p.code, { recipe: "go", answers: { module: "a" } });
  assert.match(r.chain!, /\[1\/1\] %s\\033\[0m\\n' 'Template: Go' && go mod init a && printf/);
  assert.ok(r.chain!.endsWith("✔ Setup done\\033[0m\\n'"));
  assert.ok(existsSync(join(p.code, "main.go")));
});

test("the HTTP routes resolve the tab's project and repo", async () => {
  const p = project({ "go.mod": "module x\n" });
  const tab = openTab({ project: p.id, dir: p.dir, cwd: p.code, worktree: null, title: "t" });
  const a = await app.get(`/tabs/${tab}/setup`);
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.detected.map((d: any) => d.id), ["go"]);
  const plan = await app.call("POST", `/tabs/${tab}/setup/plan`, { deps: ["go mod download"] });
  assert.deepEqual(plan.body, { writes: [], commands: [{ label: "Download Go modules", cmd: "go mod download" }] });
  const apply = await app.call("POST", `/tabs/${tab}/setup/apply`, { env: { K: "v" } });
  assert.equal(apply.status, 200);
  assert.equal(readFileSync(join(p.code, ".env"), "utf8"), "K=v\n");
  assert.equal((await app.call("POST", `/tabs/${tab}/setup/plan`, { recipe: "nope" })).status, 400);
  assert.equal((await app.get("/tabs/missing/setup")).status, 404);
  assert.equal((await app.call("POST", `/tabs/${tab}/setup/apply`)).status, 200, "an empty body applies nothing");
});
