// usage: token pricing, transcript parsing (sessions + subagents), the summary and transcript replay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, tempEnv } from "../../../host/test/harness.ts";

// PROJECTS_DIR is computed from os.homedir() at import time: point HOME at a temp folder first.
const home = tempDir("usage-home-");
process.env.HOME = home;
process.env.USERPROFILE = home;
const { PROJECTS_DIR, findTranscript, listSessions, price, transcriptEvents, usageSummary } = await import("../server/usage.ts");
const { initProjects } = await import("../../projects/server/projects.ts");

const env = tempEnv();
initProjects(env);
mkdirSync(join(env.projects, "shop", "code"), { recursive: true });

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const OLD = "33333333-3333-3333-3333-333333333333";
// Before any fixture exists: no ~/.claude/projects at all.
const noneYet = { sessions: listSessions(), transcript: findTranscript(A) };
test("listSessions is empty and findTranscript null while ~/.claude/projects does not exist", () => {
  assert.deepEqual(noneYet, { sessions: [], transcript: null });
});

const dir = join(PROJECTS_DIR, "-proj");
mkdirSync(dir, { recursive: true });
const jl = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const usage = (i: number, o: number, cw = 0, cr = 0) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr });
const T0 = "2026-01-01T10:00:00.000Z";
const T1 = "2026-01-01T11:00:00.000Z";

test("price uses the model's rates, cache multipliers and a default for unknown models", () => {
  assert.equal(price("claude-sonnet-4", usage(1_000_000, 0)).cost, 3);
  assert.equal(price("claude-haiku-4", usage(0, 1_000_000)).cost, 5);
  assert.equal(price("claude-opus-4", usage(1_000_000, 0, 1_000_000, 1_000_000)).cost, 5 + 6.25 + 0.5);
  assert.equal(price("claude-opus-5-5", usage(1_000_000, 0)).cost, 4);
  assert.equal(price("claude-sonnet-5", usage(1_000_000, 0)).cost, 2);
  assert.equal(price("fable-1", usage(1_000_000, 0)).cost, 10);
  assert.equal(price("who-knows", usage(1_000_000, 0)).cost, 3);
  assert.deepEqual(price("claude-sonnet-4", {}), { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 });
});

writeFileSync(
  join(dir, `${A}.jsonl`),
  jl(
    { type: "user", timestamp: T0, cwd: join(env.projects, "shop", "code"), entrypoint: "sdk-ts", message: { content: [{ type: "text", text: "<hidden>" }] } },
    { type: "user", isMeta: true, message: { content: "meta" } },
    { type: "user", message: { content: [{ type: "text", text: "Fix the login" }] } },
    { type: "ai-title", aiTitle: "AI title" },
    { type: "custom-title", customTitle: "My title" },
    { type: "assistant", timestamp: T1, uuid: "u1", message: { id: "m1", model: "claude-sonnet-4", usage: usage(1000, 500), content: [] } },
    { type: "assistant", uuid: "u1b", message: { id: "m1", model: "claude-sonnet-4", usage: usage(1000, 500), content: [] } },
    { type: "assistant", uuid: "u2", message: { model: "<synthetic>", usage: usage(9, 9) } },
    { type: "assistant", uuid: "u3", message: { model: "claude-haiku-4", usage: usage(100, 100) } },
  ) + "not json\n\n",
);
const sub = join(dir, A, "subagents");
mkdirSync(sub, { recursive: true });
writeFileSync(join(sub, "agent-s1.jsonl"), jl({ type: "user", timestamp: T0, message: { content: "Explore it" } }, { type: "assistant", timestamp: T1, uuid: "s", message: { id: "sm", model: "claude-haiku-4", usage: usage(1000, 1000) } }));
writeFileSync(join(sub, "agent-s1.meta.json"), JSON.stringify({ agentType: "explore", description: "looks around" }));
writeFileSync(join(sub, "agent-s2.jsonl"), jl({ type: "user", timestamp: T0, message: { content: "Second prompt" } }, { type: "assistant", uuid: "s", message: { id: "sm2", model: "claude-haiku-4", usage: usage(10, 10) } }));
writeFileSync(join(sub, "notes.txt"), "ignored");
writeFileSync(join(dir, `${B}.jsonl`), jl({ type: "user", timestamp: T0, cwd: "/somewhere/else", message: { content: "plain prompt" } }));
writeFileSync(join(dir, `${OLD}.jsonl`), jl({ type: "assistant", uuid: "o", message: { id: "o", model: "claude-sonnet-4", usage: usage(1, 1) } }));
const longAgo = new Date(Date.now() - 30 * 86_400_000);
utimesSync(join(dir, `${OLD}.jsonl`), longAgo, longAgo);
mkdirSync(join(PROJECTS_DIR, "-empty"), { recursive: true });
writeFileSync(join(PROJECTS_DIR, "stray.txt"), "not a dir");

test("listSessions reads titles, projects, models, subagents and totals; skips old and costless idle sessions", () => {
  const list = listSessions(7);
  const a = list.find((s) => s.id === A)!;
  assert.ok(a, "the session is listed");
  assert.equal(list.find((s) => s.id === OLD), undefined, "older than the window");
  assert.equal(a.title, "My title");
  assert.equal(a.project, "shop");
  assert.equal(a.source, "sdk-ts");
  assert.equal(a.start, T0);
  assert.equal(a.end, T1);
  assert.deepEqual(a.mainModels.sort(), ["claude-haiku-4", "claude-sonnet-4"]);
  assert.equal(a.main.input, 1100, "the repeated message id is counted once, <synthetic> never");
  assert.equal(a.agents.length, 2);
  const ex = a.agents.find((x) => x.type === "explore")!;
  assert.equal(ex.agentId, "s1");
  assert.equal(ex.description, "looks around");
  assert.equal(ex.tokens.input, 1000);
  const other = a.agents.find((x) => x.type === "subagent")!;
  assert.equal(other.description, "Second prompt");
  assert.equal(a.active, true, "files were just written");
  assert.ok(Math.abs(a.total.cost - (a.main.cost + ex.tokens.cost + other.tokens.cost)) < 1e-9);
  assert.equal(a.byModel["claude-haiku-4"]!.input, 100 + 1000 + 10);
  const b = list.find((s) => s.id === B)!;
  assert.equal(b.project, "else", "outside projects/: the folder name");
  assert.equal(b.title, "plain prompt");
  assert.equal(b.total.cost, 0);
});

test("a second call is served from the parse cache with the same numbers", () => {
  assert.equal(listSessions(7).find((s) => s.id === A)!.main.input, 1100);
});

test("usageSummary groups cost by project, agent type, model and day", () => {
  const sum = usageSummary(7);
  assert.equal(sum.days, 7);
  assert.equal(sum.sessions, listSessions(7).length);
  assert.ok(sum.active.includes(A));
  assert.ok(sum.total.cost > 0);
  assert.equal(sum.byProject.find((b) => b.key === "shop")!.count, 1);
  assert.deepEqual(sum.byAgent.map((b) => b.key).sort(), ["explore", "main", "subagent"]);
  assert.ok(sum.byModel.length >= 2);
  assert.ok(sum.byProject[0]!.tokens.cost >= sum.byProject[sum.byProject.length - 1]!.tokens.cost, "sorted by cost");
  assert.ok(sum.byDay.some((d) => d.key === "2026-01-01"));
  assert.ok(sum.today.cost >= 0);
});

test("findTranscript validates the id and searches every project folder", () => {
  assert.equal(findTranscript(A), join(dir, `${A}.jsonl`));
  assert.equal(findTranscript("../../etc/passwd"), null);
  assert.equal(findTranscript("44444444-4444-4444-4444-444444444444"), null);
});

test("transcriptEvents replays user text, tool calls and results; skips meta, sidechains and repeats", () => {
  const file = join(dir, "replay.jsonl");
  writeFileSync(
    file,
    jl(
      { type: "user", message: { content: "hello" } },
      { type: "user", message: { content: "<command>x</command>" } },
      { type: "user", isMeta: true, message: { content: "meta" } },
      { type: "user", isSidechain: true, message: { content: "side" } },
      { type: "user", message: { content: [{ type: "text", text: "look" }, { type: "image" }, { type: "text", text: "<skip>" }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "r".repeat(3000), is_error: true }, { type: "tool_result", tool_use_id: "t2", content: [{ text: "a" }, {}] }, { type: "tool_result", tool_use_id: "t3", content: 5 }] } },
      { type: "assistant", message: { id: "m", content: [{ type: "text", text: "answer" }, { type: "text", text: "  " }, { type: "tool_use", id: "t1", name: "Bash", input: { c: 1 } }] } },
      { type: "assistant", message: { id: "m", content: [{ type: "text", text: "answer" }, { type: "tool_use", id: "t1", name: "Bash", input: { c: 1 } }] } },
      { type: "assistant", message: { id: "n", content: "not an array" } },
    ) + "garbage\n",
  );
  const ev = transcriptEvents(file) as any[];
  assert.deepEqual(ev.map((e) => e.kind), ["user", "user", "tool_result", "tool_result", "tool_result", "text", "tool"]);
  assert.equal(ev[1].text, "look\n[1 imagen(es)]");
  assert.equal(ev[2].text.length, 2000);
  assert.equal(ev[2].isError, true);
  assert.equal(ev[3].text, "a\n");
  assert.equal(ev[4].text, "");
  assert.equal(transcriptEvents(file, 2).length, 2, "only the tail");
});
