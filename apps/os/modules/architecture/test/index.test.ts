// The architecture routes against a throwaway environment, with the Claude calls replaced by canned answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { openTab, restoreTabs } from "../../sessions/server/agent.ts";
import { contributions } from "../../sessions/server/contributions.ts";
import register from "../server/index.ts";
import { answerLanguage, deps } from "../server/advisor.ts";

const env = tempEnv();
initProjects(env);
restoreTabs(join(env.state, "tabs.json"));
const dir = join(env.projects, "shop");
const code = join(dir, "code");
mkdirSync(join(code, "src", "api"), { recursive: true });
mkdirSync(join(code, "node_modules", "x"), { recursive: true });
writeFileSync(join(code, "src", "a.ts"), "export {};\n");
writeFileSync(join(dir, "AGENTS.md"), "# shop\n");
mkdirSync(join(env.projects, "bare"), { recursive: true });
writeFileSync(join(env.projects, "bare", "AGENTS.md"), "# bare\n"); // a project without code/

const prompts: string[] = [];
let structuredOut: unknown = { summary: "ok", steps: [{ title: "Split", detail: "d", files: ["src/a.ts", "src/a.ts", "../x", "nope.ts"] }] };
deps.structured = (async (prompt: string) => {
  prompts.push(prompt);
  return { out: structuredOut, cost: 0.5 };
}) as typeof deps.structured;
deps.ask = (async (prompt: string, system: string) => {
  prompts.push(`${system}\n${prompt}`);
  return { text: "an answer", cost: 0.1 };
}) as typeof deps.ask;

const { call, get } = await mountModule(register, { env });
const arch = (p: string) => `/architecture/shop${p}`;

test("an unknown project is a 404 on every read and write", async () => {
  assert.equal((await get("/architecture/ghost")).status, 404);
  assert.equal((await call("PUT", "/architecture/ghost/doc", { markdown: "x" })).status, 404);
  assert.equal((await call("POST", "/architecture/ghost/import")).status, 404);
  assert.equal((await call("DELETE", "/architecture/ghost/chat")).status, 404);
  assert.equal((await call("POST", "/architecture/ghost/chat", { message: "hi" })).status, 404);
});

test("a fresh project reads the template and nothing saved", async () => {
  const r = await get(arch(""));
  assert.equal(r.status, 200);
  assert.equal(r.body.exists, false);
  assert.match(r.body.markdown, /# Architecture · shop/);
  assert.deepEqual(r.body.tree, { nodes: [] });
  assert.equal(r.body.advice, null);
  assert.deepEqual(r.body.chat, []);
});

test("the doc is validated, size capped and saved atomically", async () => {
  assert.equal((await call("PUT", arch("/doc"), {})).status, 400);
  assert.equal((await call("PUT", arch("/doc"), { markdown: "x".repeat(200 * 1024 + 1) })).status, 413);
  assert.deepEqual((await call("PUT", arch("/doc"), { markdown: "# Mine\n\nUse layers.\n" })).body, { ok: true });
  const r = await get(arch(""));
  assert.equal(r.body.exists, true);
  assert.equal(r.body.markdown, "# Mine\n\nUse layers.\n");
  assert.equal(readFileSync(join(dir, "context", "architecture", "architecture.md"), "utf8"), "# Mine\n\nUse layers.\n");
});

test("the tree is validated on save and an unreadable tree.json is kept as .bak", async () => {
  assert.equal((await call("PUT", arch("/tree"), { tree: { nodes: "no" } })).status, 400);
  const saved = await call("PUT", arch("/tree"), { tree: { nodes: [{ id: "a", name: "src", parentId: null, rules: "# r" }] } });
  assert.equal(saved.status, 200);
  assert.equal((await get(arch(""))).body.tree.nodes[0].name, "src");
  const tf = join(dir, "context", "architecture", "tree.json");
  writeFileSync(tf, "{ broken");
  assert.deepEqual((await get(arch(""))).body.tree, { nodes: [] });
  assert.equal(readFileSync(`${tf}.bak`, "utf8"), "{ broken");
});

test("import seeds the tree with the repo's real folders, skipping node_modules", async () => {
  const r = await call("POST", arch("/import"));
  assert.equal(r.status, 200);
  const names = r.body.nodes.map((n: { name: string }) => n.name).sort();
  assert.deepEqual(names, ["api", "src"]);
  assert.equal((await call("POST", "/architecture/bare/import")).status, 404, "no code/ yet");
});

test("advise rejects an invalid mode and a project without code", async () => {
  assert.equal((await call("POST", arch("/advise"), { mode: "x" })).status, 400);
  assert.equal((await call("POST", arch("/advise"), {})).status, 400);
  assert.equal((await call("POST", "/architecture/bare/advise", { mode: "start" })).status, 404);
});

test("advise keeps only existing repo files, saves the advice and writes in the asked language", async () => {
  const r = await call("POST", arch("/advise"), { mode: "analyze", focus: "  the api  ", lang: "es" });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, "analyze");
  assert.deepEqual(r.body.steps[0].files, ["src/a.ts"]);
  assert.equal(r.body.cost, 0.5);
  assert.match(prompts.at(-1)!, /Spanish with Rioplatense voseo/);
  assert.match(prompts.at(-1)!, /Pay special attention to: the api/);
  assert.match(prompts.at(-1)!, /Use layers\./, "the defined architecture is in the prompt");
  assert.equal((await get(arch(""))).body.advice.summary, "ok");
  assert.equal(existsSync(join(dir, "context", "architecture", "advice.json")), true);
});

test("advise answers 502 when the agent returns no steps, and the project is free again afterwards", async () => {
  structuredOut = { summary: "nothing", steps: [] };
  assert.equal((await call("POST", arch("/advise"), { mode: "start" })).status, 502);
  structuredOut = { summary: "back", steps: [{ title: "t", detail: "d", files: [] }] };
  assert.equal((await call("POST", arch("/advise"), { mode: "start" })).status, 200);
});

test("only one analysis per project at a time", async () => {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const before = deps.structured;
  deps.structured = (async () => (await hold, { out: structuredOut, cost: 0 })) as typeof deps.structured;
  const first = call("POST", arch("/advise"), { mode: "start" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await call("POST", arch("/advise"), { mode: "start" })).status, 409);
  release();
  assert.equal((await first).status, 200);
  deps.structured = before;
});

test("chat validates the message, keeps the history and clear empties it", async () => {
  assert.equal((await call("POST", arch("/chat"), { message: "   " })).status, 400);
  assert.equal((await call("POST", arch("/chat"), { message: "x".repeat(4001) })).status, 400);
  const r = await call("POST", arch("/chat"), { message: "where do I start?", lang: "en" });
  assert.equal(r.body.reply, "an answer");
  assert.deepEqual(r.body.messages.map((m: { role: string }) => m.role), ["user", "assistant"]);
  await call("POST", arch("/chat"), { message: "and then?" });
  assert.match(prompts.at(-1)!, /Conversation so far:\nUser: where do I start\?\nArchitect: an answer/);
  assert.equal((await get(arch(""))).body.chat.length, 4);
  assert.deepEqual((await call("DELETE", arch("/chat"))).body, { ok: true });
  assert.deepEqual((await get(arch(""))).body.chat, []);
});

test("chats of a project run one after another, and a failing one does not block the next", async () => {
  const order: string[] = [];
  deps.ask = (async (prompt: string) => {
    const tag = /User message: (\w+)/.exec(prompt)![1]!;
    order.push(`start ${tag}`);
    await new Promise((r) => setTimeout(r, 30));
    order.push(`end ${tag}`);
    if (tag === "boom") throw new Error("model down");
    return { text: tag, cost: 0 };
  }) as typeof deps.ask;
  const [a, b, c] = await Promise.all(["one", "boom", "three"].map((m) => call("POST", arch("/chat"), { message: m })));
  assert.equal(a!.status, 200);
  assert.equal(b!.status, 500);
  assert.equal(c!.status, 200);
  // HTTP does not promise arrival order — Promise.all can deliver boom before one. The contract is
  // serialization: every chat runs start→end without interleaving, and the failing one does not block.
  assert.deepEqual([...order].sort(), ["end boom", "end one", "end three", "start boom", "start one", "start three"]);
  for (const tag of ["one", "boom", "three"]) {
    assert.equal(order.indexOf(`end ${tag}`), order.indexOf(`start ${tag}`) + 1, `${tag} ran to completion before the next chat started`);
  }
});

test("a long past message is shortened in later prompts", async () => {
  const seen: string[] = [];
  deps.ask = (async (prompt: string) => (seen.push(prompt), { text: "y".repeat(2000), cost: 0 })) as typeof deps.ask;
  await call("DELETE", arch("/chat"));
  await call("POST", arch("/chat"), { message: "first" });
  await call("POST", arch("/chat"), { message: "second" });
  assert.match(seen[1]!, /y{1500}…/);
  assert.doesNotMatch(seen[1]!, /y{1501}/);
});

test("answerLanguage defaults to English", () => {
  assert.equal(answerLanguage("es"), "es");
  assert.equal(answerLanguage("fr"), "en");
  assert.equal(answerLanguage(undefined), "en");
});

test("the tab switch needs a known tab and sets archOff", async () => {
  assert.equal((await call("POST", "/tabs/nope/architecture", { on: false })).status, 404);
  const tab = openTab({ project: "shop", dir, cwd: code, title: "shop" });
  assert.deepEqual((await call("POST", `/tabs/${tab}/architecture`, { on: false })).body, { ok: true });
  const note = contributions().map((c) => c.promptNote).filter(Boolean);
  const tabCtx = (meta: Record<string, unknown>, project = "shop") => ({ id: tab, title: "", project, dir, cwd: code, worktree: null, meta });
  const texts = (meta: Record<string, unknown>, project?: string) => note.map((f) => f!(tabCtx(meta, project))).filter(Boolean);
  assert.equal(texts({ archOff: true }).length, 0, "off for this tab");
  assert.equal(texts({}, "").length, 0, "no project, no note");
  assert.match(texts({}).join("\n"), /Architecture the user defined/);
  assert.deepEqual((await call("POST", `/tabs/${tab}/architecture`, { on: true })).body, { ok: true });
});
