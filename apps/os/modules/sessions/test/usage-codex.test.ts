// usage-codex: sessions from Codex's rollout JSONL files, with HOME pointed at a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";

const home = tempDir("usage-codex-home-");
process.env.HOME = home; // os.homedir() reads HOME on POSIX and USERPROFILE on Windows
process.env.USERPROFILE = home;
const { listCodexSessions } = await import("../server/usage-codex.ts");
const { listSessions, usageSummary } = await import("../server/usage.ts"); // registers the adapter

test("a missing sessions directory lists nothing, never throws", () => {
  const other = tempDir("usage-codex-empty-");
  const up = process.env.USERPROFILE;
  const hm = process.env.HOME;
  process.env.USERPROFILE = other;
  process.env.HOME = other;
  try {
    assert.deepEqual(listCodexSessions(7), []);
  } finally {
    process.env.USERPROFILE = up;
    process.env.HOME = hm;
  }
});

const jl = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const sessionsDir = join(home, ".codex", "sessions", "2026", "10", "17");
mkdirSync(sessionsDir, { recursive: true });

const A = "rollout-2026-10-17T10-00-00-11111111-1111-1111-1111-111111111111.jsonl";
writeFileSync(
  join(sessionsDir, A),
  jl(
    { timestamp: "2026-10-17T10:00:00.000Z", type: "session_meta", payload: { session_id: "11111111-1111-1111-1111-111111111111", cwd: "C:/work/shop/code", originator: "codex_cli_rs" } },
    { timestamp: "2026-10-17T10:00:01.000Z", type: "turn_context", payload: { model: "gpt-5.5" } },
    { timestamp: "2026-10-17T10:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 10, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 2, total_tokens: 105 } } } },
    { timestamp: "2026-10-17T10:05:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the login bug" }] } },
    { timestamp: "2026-10-17T10:06:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 2_000_000, cache_write_input_tokens: 0, output_tokens: 100_000, reasoning_output_tokens: 30_000, total_tokens: 3_100_000 } } } },
    { timestamp: "2026-10-17T10:07:00.000Z", type: "event_msg", payload: { type: "task_complete" } },
  ) + "garbage line\n",
);
const B = "rollout-2026-09-10T10-00-00-22222222-2222-2222-2222-222222222222.jsonl";
mkdirSync(join(home, ".codex", "sessions", "2026", "9", "10"), { recursive: true });
writeFileSync(
  join(home, ".codex", "sessions", "2026", "9", "10", B),
  jl(
    { timestamp: "2026-09-10T10:00:00.000Z", type: "session_meta", payload: { session_id: "22222222-2222-2222-2222-222222222222", cwd: "C:/work/shop/code", originator: "Codex Desktop" } },
    { timestamp: "2026-09-10T10:00:01.000Z", type: "turn_context", payload: { model: "gpt-5-mini" } },
    { timestamp: "2026-09-10T10:05:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, total_tokens: 1_000_000 } } } },
  ),
);
const C = "rollout-2026-10-17T11-00-00-33333333-3333-3333-3333-333333333333.jsonl";
writeFileSync(
  join(sessionsDir, C),
  jl(
    { timestamp: "2026-10-17T11:00:00.000Z", type: "session_meta", payload: { session_id: "33333333-3333-3333-3333-333333333333", cwd: "C:/work/elsewhere", originator: "Codex Desktop" } },
    { timestamp: "2026-10-17T11:00:01.000Z", type: "turn_context", payload: { model: "gpt-9000" } },
    { timestamp: "2026-10-17T11:01:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<ENVIRONMENT>skip me</ENVIRONMENT>" }] } },
    { timestamp: "2026-10-17T11:02:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Refactor the router" }] } },
    { timestamp: "2026-10-17T11:03:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 50, total_tokens: 550 } } } },
  ),
);
const D = "rollout-2026-10-16T09-00-00-44444444-4444-4444-4444-444444444444.jsonl";
writeFileSync(join(sessionsDir, D), jl({ timestamp: "2026-10-16T09:00:00.000Z", type: "session_meta", payload: { session_id: "44444444-4444-4444-4444-444444444444", cwd: "C:/work/shop/code" } }) + "not json\n");
// No session_id, no cwd, no turn_context, no user message: every fallback at once.
const E = "rollout-2026-10-17T12-00-00-55555555-5555-5555-5555-555555555555.jsonl";
writeFileSync(
  join(sessionsDir, E),
  jl(
    { timestamp: "2026-10-17T12:00:00.000Z", type: "session_meta", payload: {} },
    { timestamp: "2026-10-17T12:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 50, total_tokens: 250 } } } },
  ),
);
// Live-ish but not active (5 min old): kept because it has cost. Text-less content blocks first.
const F = "rollout-2026-10-17T13-00-00-66666666-6666-6666-6666-666666666666.jsonl";
writeFileSync(
  join(sessionsDir, F),
  jl(
    { timestamp: "2026-10-17T13:00:00.000Z", type: "session_meta", payload: { session_id: "66666666-6666-6666-6666-666666666666", cwd: "C:/work/shop/code", originator: "Codex Desktop" } },
    { timestamp: "2026-10-17T13:00:01.000Z", type: "turn_context", payload: { model: "gpt-5-nano" } },
    { timestamp: "2026-10-17T13:01:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text" }] } },
    { timestamp: "2026-10-17T13:02:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Write a test" }] } },
    { timestamp: "2026-10-17T13:03:00.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, total_tokens: 1_000_000 } } } },
  ),
);
// Not live and no usage: dropped.
const G = "rollout-2026-10-17T14-00-00-77777777-7777-7777-7777-777777777777.jsonl";
writeFileSync(
  join(sessionsDir, G),
  jl({ timestamp: "2026-10-17T14:00:00.000Z", type: "session_meta", payload: { session_id: "77777777-7777-7777-7777-777777777777", cwd: "C:/work/shop/code" } }),
);
const fresh = new Date();
for (const f of [join(sessionsDir, A), join(sessionsDir, C), join(sessionsDir, E)]) utimesSync(f, fresh, fresh);
const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
for (const f of [join(sessionsDir, F), join(sessionsDir, G)]) utimesSync(f, fiveMinAgo, fiveMinAgo);
const longAgo = new Date(Date.now() - 30 * 86_400_000);
for (const f of [join(home, ".codex", "sessions", "2026", "9", "10", B), join(sessionsDir, D)]) utimesSync(f, longAgo, longAgo);

test("rollouts yield the last cumulative token_count, priced with the GPT table", () => {
  const list = listCodexSessions(7);
  const a = list.find((s) => s.id === "11111111-1111-1111-1111-111111111111")!;
  assert.ok(a, "the recent rollout is listed");
  assert.equal(a.provider, "codex");
  assert.equal(a.usageAvailable, true);
  assert.equal(a.project, "code", "project = the cwd's folder name");
  assert.equal(a.source, "codex_cli_rs");
  assert.equal(a.title, "Fix the login bug");
  assert.equal(a.start, "2026-10-17T10:00:00.000Z");
  assert.equal(a.end, "2026-10-17T10:07:00.000Z", "the last event's timestamp");
  assert.equal(a.main.input, 1_000_000, "the LAST cumulative count wins");
  assert.equal(a.main.output, 100_000, "reasoning tokens are a subset of output, not added twice");
  assert.equal(a.main.cacheRead, 2_000_000);
  assert.deepEqual(a.mainModels, ["gpt-5.5"]);
  // gpt-5.5: $5 in, $30 out, $0.50 cached -> (1M*5 + 100k*30 + 2M*0.50) / 1M = 5 + 3 + 1
  assert.ok(Math.abs(a.total.cost - 9) < 1e-9);
  assert.equal(a.active, true);
  const c = list.find((s) => s.id === "33333333-3333-3333-3333-333333333333")!;
  assert.equal(c.title, "Refactor the router", "the environment dump is skipped for the title");
  assert.equal(c.total.cost, 0, "an unknown model keeps its tokens but costs 0");
  const e = list.find((s) => s.id === "55555555-5555-5555-5555-555555555555")!;
  assert.ok(e, "a rollout without session_id takes its id from the file name");
  assert.equal(e.project, "?", "no cwd at all");
  assert.equal(e.source, "codex", "no originator keeps the default");
  assert.deepEqual(e.mainModels, [], "no turn_context: no model to name");
  assert.equal(e.title, "55555555", "no user message: the id prefix");
  assert.equal(e.total.cost, 0);
  assert.equal(e.total.input, 200);
  const f = list.find((s) => s.id === "66666666-6666-6666-6666-666666666666")!;
  assert.equal(f.title, "Write a test", "a content block without text is skipped");
  assert.ok(Math.abs(f.total.cost - 0.05) < 1e-9, "gpt-5-nano: 1M input at $0.05");
  assert.equal(f.active, false, "five minutes old");
  assert.ok(!list.some((s) => s.id === "77777777-7777-7777-7777-777777777777"), "no usage and not live: dropped");
  assert.equal(list.find((s) => s.id === "22222222-2222-2222-2222-222222222222"), undefined, "older than the window");
  assert.equal(list.find((s) => s.id === "44444444-4444-4444-4444-444444444444"), undefined, "no usage and stale");
});

test("the provider registers: listSessions and usageSummary see codex sessions", () => {
  const list = listSessions(7, "codex");
  assert.ok(list.some((s) => s.id === "11111111-1111-1111-1111-111111111111"));
  assert.ok(!listSessions(7, "claude").some((s) => s.id === "11111111-1111-1111-1111-111111111111"));
  const bucket = usageSummary(7).byProvider.find((b) => b.key === "codex")!;
  assert.ok(bucket, "byProvider includes codex");
  assert.ok(Math.abs(bucket.tokens.cost - 9.05) < 1e-9, "A's 9 plus F's 0.05");
  assert.equal(bucket.count, 4, "A, C, E and F");
});
