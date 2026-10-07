// The practice routes and the plan/snippet/validate logic, with the Claude calls replaced by canned answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../../../host/test/harness.ts";
import { initProjects } from "../../../../projects/server/projects.ts";
import { openTab, restoreTabs } from "../../../../sessions/server/agent.ts";
import { initSkills } from "../../../../sessions/server/skills.ts";
import register from "../server/index.ts";
import { deps, dropPractice, makePlan, readPractice, snippet, validate } from "../server/practice.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

const env = tempEnv();
initProjects(env);
initSkills(env);
writeFileSync(join(env.library, "profile.json"), JSON.stringify({ language: "es" }));
restoreTabs(join(env.state, "tabs.json"));
const dir = join(env.projects, "demo");
const code = join(dir, "code");
mkdirSync(code, { recursive: true });
writeFileSync(join(dir, "AGENTS.md"), "# demo\n");
git(code, "init", "-q", "-b", "main");
git(code, "config", "user.name", "T");
git(code, "config", "user.email", "t@example.com");
git(code, "config", "commit.gpgsign", "false");
writeFileSync(join(code, "app.ts"), "export const a = 1;\n");
git(code, "add", "-A");
git(code, "commit", "-q", "-m", "first");
const tab = openTab({ project: "demo", dir, cwd: code, worktree: null, title: "demo" });

const step = { id: "s1", file: "app.ts", isNew: false, goal: "double a", why: "w", line: 1, mode: "edit", endLine: 1, pointer: "p", approach: "a", skeleton: "s", checks: ["c"] };
const planOut = { title: "T", summary: "S", steps: [step], terminal: [{ id: "t1", goal: "branch", hint: "h", command: "git switch -c x" }] };

const prompts: string[] = [];
deps.structured = (async (prompt: string, _cwd: string, schema: Record<string, any>, extra: string[] = []) => {
  prompts.push(prompt + `\n[extra:${extra.length}]`);
  return { out: schema.required.includes("verdict") ? { verdict: "almost", overall: "o", steps: [], terminal: [], next: "n" } : planOut, cost: 0.5 };
}) as typeof deps.structured;
deps.query = (async function* () {
  yield { type: "assistant" };
  yield { type: "result", subtype: "error_max_turns", total_cost_usd: 0.1 };
  yield { type: "result", subtype: "success", result: "const a = 2;", total_cost_usd: 0.25 };
}) as unknown as typeof deps.query;

const app = await mountModule(register, { env });
const url = (p: string) => `/tabs/${tab}/practice${p}`;

test("unknown tab is a 404 and an empty tab has no plan", async () => {
  assert.equal((await app.get("/tabs/nope/practice")).status, 404);
  assert.deepEqual((await app.get(url(""))).body, { plan: null, review: null });
});

test("snippet and validate refuse to run before a plan exists", async () => {
  assert.equal((await app.call("POST", url("/snippet"), { stepId: "s1" })).status, 404);
  const v = await app.call("POST", url("/validate"), {});
  assert.equal(v.status, 400);
  assert.match(v.body.error, /plan first/);
});

test("plan is stored with the task, cost and no context folder passed when there is none", async () => {
  const r = await app.call("POST", url("/plan"), { task: "double it" });
  assert.equal(r.status, 200);
  assert.equal(r.body.task, "double it");
  assert.equal(r.body.cost, 0.5);
  assert.equal(r.body.steps[0].id, "s1");
  assert.match(prompts.at(-1)!, /double it/);
  assert.match(prompts.at(-1)!, /language with code "es"/);
  assert.match(prompts.at(-1)!, /\[extra:0\]/);
  assert.doesNotMatch(prompts.at(-1)!, /Project context/);
  assert.equal((await app.get(url(""))).body.plan.title, "T");
});

test("a project context folder is offered to the planner", async () => {
  mkdirSync(join(dir, "context"));
  const plan = await makePlan(tab, code, dir, "");
  assert.match(prompts.at(-1)!, /Project context \(read only\)/);
  assert.match(prompts.at(-1)!, /\[extra:1\]/);
  assert.equal(plan.task, "");
});

test("snippet returns the successful result text and the last cost", async () => {
  const r = await app.call("POST", url("/snippet"), { stepId: "s1" });
  assert.deepEqual(r.body, { text: "const a = 2;", cost: 0.25 });
  assert.equal((await app.call("POST", url("/snippet"), { stepId: "zzz" })).status, 404);
});

test("validate reviews the git state, survives unreadable new files and stores the review", async () => {
  writeFileSync(join(code, "app.ts"), "export const a = 2;\n");
  writeFileSync(join(code, "new.ts"), "export const b = 1;\n");
  writeFileSync(join(code, "blob.bin"), Buffer.from([0, 1, 2, 3]));
  const r = await app.call("POST", url("/validate"), {});
  assert.equal(r.status, 200);
  assert.equal(r.body.verdict, "almost");
  assert.equal(r.body.cost, 0.5);
  const prompt = prompts.at(-1)!;
  assert.match(prompt, /branch: main/);
  assert.match(prompt, /-export const a = 1;/);
  assert.match(prompt, /\+export const a = 2;/);
  assert.match(prompt, /--- new\.ts \(new\)/);
  assert.match(prompt, /--- blob\.bin \(new, not shown: Binary file\)/);
  assert.equal((await app.get(url(""))).body.review.verdict, "almost");
});

test("validate outside a git repository still reaches the reviewer with an empty git state", async () => {
  const plain = join(env.root, "plain");
  mkdirSync(plain);
  const review = await validate(tab, plain);
  assert.equal(review.verdict, "almost");
  assert.match(prompts.at(-1)!, /\(clean\)/);
  assert.match(prompts.at(-1)!, /\(no changes in tracked files\)/);
  assert.match(prompts.at(-1)!, /\(none\)/);
});

test("closing a tab drops its practice file", () => {
  const file = join(app.ctx.dataDir, `${tab}.json`);
  assert.ok(existsSync(file));
  dropPractice(tab);
  assert.ok(!existsSync(file));
  assert.deepEqual(readPractice(tab), { plan: null, review: null });
  assert.rejects(snippet(tab, code, "s1"), /Step not found/);
});
