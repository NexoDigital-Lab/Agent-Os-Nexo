// The notes routes, including the AI analysis with the SDK replaced by a canned answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { initSkills } from "../../sessions/server/skills.ts";
import register from "../server/index.ts";
import { deps } from "../server/notes.ts";

const env = tempEnv();
initProjects(env);
initSkills(env);
writeFileSync(join(env.library, "profile.json"), JSON.stringify({ language: "es" }));
const shop = join(env.projects, "shop");
mkdirSync(join(shop, "code"), { recursive: true });
writeFileSync(join(shop, "AGENTS.md"), "# shop\n");
mkdirSync(join(env.projects, "docsonly"), { recursive: true });
writeFileSync(join(env.projects, "docsonly", "AGENTS.md"), "# d\n"); // no code/

const proposal = { title: "Login", type: "feature", priority: "P1", size: "S", description: "d", criteria: ["works", ""], why: "w", sourceNotes: [] };
const calls: { prompt: string; options: any }[] = [];
let answer: unknown[] = [{ type: "result", subtype: "success", total_cost_usd: 0.3, structured_output: { summary: "s", features: [proposal] } }];
deps.query = (async function* (args: { prompt: string; options: any }) {
  calls.push(args);
  yield { type: "assistant" };
  yield* answer;
}) as unknown as typeof deps.query;

const { call, get } = await mountModule(register, { env });

test("notes are created, edited through PUT, listed newest first and deleted", async () => {
  const a = (await call("POST", "/notes", { title: "one", project: "shop", body: "login" })).body;
  assert.match(a.id, /^[0-9a-f]{8}$/);
  await new Promise((r) => setTimeout(r, 5));
  const b = (await call("POST", "/notes", { title: "two", project: "shop", body: "cart" })).body;
  assert.deepEqual((await get("/notes")).body.map((n: { id: string }) => n.id), [b.id, a.id]);
  const edited = await call("PUT", `/notes/${a.id}`, { body: "login with google", id: "ignored" });
  assert.equal(edited.body.id, a.id, "the id comes from the URL");
  assert.equal(edited.body.title, "one", "fields not sent are kept");
  assert.equal((await get("/notes")).body[0].id, a.id, "an edit moves it to the top");
  assert.equal((await call("POST", "/notes", { project: "../etc" })).status, 400);
  assert.equal((await call("POST", "/notes", { project: ".hidden" })).status, 400);
  assert.deepEqual((await call("DELETE", `/notes/${b.id}`)).body, { ok: true });
  assert.equal((await get("/notes")).body.length, 1);
});

test("analyze needs notes of exactly one project", async () => {
  assert.equal((await call("POST", "/notes/analyze", { ids: [] })).status, 400);
  assert.equal((await call("POST", "/notes/analyze", {})).status, 400);
  assert.equal((await call("POST", "/notes/analyze", { ids: ["nope"] })).status, 400);
  const x = (await call("POST", "/notes", { project: "other", body: "x" })).body;
  const y = (await call("POST", "/notes", { project: "shop", body: "y" })).body;
  const r = await call("POST", "/notes/analyze", { ids: [x.id, y.id] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /one project at a time/);
});

test("analyze an existing project: read-only tools confined to it, proposals returned, note stamped", async () => {
  const note = (await get("/notes")).body.find((n: { project: string }) => n.project === "shop");
  const r = await call("POST", "/notes/analyze", { ids: [note.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { project: "shop", exists: true, summary: "s", proposals: [proposal], cost: 0.3 });
  const { prompt, options } = calls.at(-1)!;
  assert.match(prompt, /The project EXISTS/);
  assert.match(prompt, /language with code "es"/);
  assert.deepEqual(options.tools, ["Read", "Glob", "Grep"]);
  assert.equal(options.cwd, join(shop, "code"));
  assert.equal(options.additionalDirectories.length, 2);
  assert.equal(options.hooks.PreToolUse.length, 1);
  assert.ok((await get("/notes")).body.find((n: { id: string }) => n.id === note.id).analyzedAt);
});

test("analyze a project that does not exist yet: no tools, foundational prompt, drafts listed as open", async () => {
  const note = (await get("/notes")).body.find((n: { project: string }) => n.project === "other");
  await call("POST", "/notes/accept", { project: "other", proposals: [{ ...proposal, title: "Already drafted" }] });
  const r = await call("POST", "/notes/analyze", { ids: [note.id] });
  assert.equal(r.body.exists, false);
  const { prompt, options } = calls.at(-1)!;
  assert.match(prompt, /It is a NEW project/);
  assert.match(prompt, /- Already drafted/);
  assert.deepEqual(options.tools, []);
  assert.equal(options.additionalDirectories.length, 0);
});

test("a project with docs but no code/ is read from its context folder", async () => {
  const n = (await call("POST", "/notes", { project: "docsonly", body: "z" })).body;
  await call("POST", "/notes/analyze", { ids: [n.id] });
  assert.equal(calls.at(-1)!.options.cwd, join(env.projects, "docsonly", "context"));
});

test("analyze answers 502 when Claude gives no result, and the note is not stamped", async () => {
  const n = (await call("POST", "/notes", { project: "shop", body: "again" })).body;
  answer = [{ type: "result", subtype: "error_max_turns", total_cost_usd: 0.1 }];
  const r = await call("POST", "/notes/analyze", { ids: [n.id] });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /error_max_turns/);
  assert.equal((await get("/notes")).body.find((x: { id: string }) => x.id === n.id).analyzedAt, undefined);
  answer = [];
  assert.match((await call("POST", "/notes/analyze", { ids: [n.id] })).body.error, /no output/);
});

test("accept writes features for an existing project; drafts are promoted or deleted", async () => {
  const r = await call("POST", "/notes/accept", { project: "shop", proposals: [proposal] });
  assert.equal(r.body.features.length, 1);
  assert.equal((await call("POST", "/notes/accept", { project: "bad..name", proposals: [] })).status, 400);
  const drafts = (await get("/notes/drafts")).body;
  assert.equal(drafts.length, 1);
  assert.equal((await call("POST", "/notes/drafts/promote", { project: "other" })).status, 409);
  assert.deepEqual((await call("DELETE", `/notes/drafts/${drafts[0].id}`)).body, { ok: true });
  assert.deepEqual((await get("/notes/drafts")).body, []);
  await call("POST", "/notes/accept", {});
  assert.equal((await call("POST", "/notes/accept", { project: "other" })).body.drafts, 0, "no proposals, nothing saved");
  await call("POST", "/notes/accept", { project: "later", proposals: [proposal] });
  mkdirSync(join(env.projects, "later"));
  writeFileSync(join(env.projects, "later", "AGENTS.md"), "# l\n");
  assert.equal((await call("POST", "/notes/drafts/promote", { project: "later" })).body.features.length, 1);
});
