// translate(): SDK messages become the events the tab renders, and update the session id / cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { lastTask, translate, type Ev } from "../server/sdkEvents.ts";

const run = (msgs: unknown[], s: { events: Ev[]; sdkSessionId?: string; cost: number } = { events: [], cost: 0 }) => {
  const out: Ev[] = [];
  for (const m of msgs) {
    translate(s, m as SDKMessage, (ev) => (out.push(ev), s.events.push(ev)));
  }
  return { out, s };
};

test("init stores the session id and reports model, skills and mode", () => {
  const { out, s } = run([{ type: "system", subtype: "init", session_id: "abc", model: "m", skills: ["a"], permissionMode: "default" }]);
  assert.equal(s.sdkSessionId, "abc");
  assert.deepEqual(out, [{ kind: "init", model: "m", skills: ["a"], mode: "default" }]);
});

test("task lifecycle: started, progress keeps the description, updated, notification", () => {
  const { out } = run([
    { type: "system", subtype: "task_started", task_id: "t", tool_use_id: "u", subagent_type: "explore", description: "look" },
    { type: "system", subtype: "task_progress", task_id: "t", description: "reading", summary: "now reading", usage: { total_tokens: 5, tool_uses: 2, duration_ms: 9 }, last_tool_name: "Read" },
    { type: "system", subtype: "task_updated", task_id: "t", patch: { status: "paused" } },
    { type: "system", subtype: "task_updated", task_id: "t", patch: {} },
    { type: "system", subtype: "task_updated", task_id: "zzz", patch: { status: "killed" } },
    { type: "system", subtype: "task_notification", task_id: "t", status: "completed", summary: "done", usage: { total_tokens: 7, tool_uses: 3, duration_ms: 11 } },
    { type: "system", subtype: "task_notification", task_id: "new", status: "failed", summary: "boom" },
  ]);
  assert.equal(out.length, 5, "an update without status or for an unknown task emits nothing");
  assert.deepEqual(out[0], { kind: "task", id: "t", toolUseId: "u", type: "explore", description: "look", status: "running" });
  assert.equal(out[1]!.kind === "task" && out[1]!.description, "look");
  assert.equal(out[1]!.kind === "task" && out[1]!.now, "now reading");
  assert.equal(out[1]!.kind === "task" && out[1]!.tokens, 5);
  assert.equal(out[2]!.kind === "task" && out[2]!.status, "paused");
  assert.equal(out[3]!.kind === "task" && out[3]!.status, "completed");
  assert.equal(out[3]!.kind === "task" && out[3]!.tokens, 7);
  assert.equal(out[3]!.kind === "task" && out[3]!.toolUseId, "u");
  assert.deepEqual(out[4], { kind: "task", id: "new", type: "task", description: "", toolUseId: undefined, status: "failed", summary: "boom", tokens: undefined, tools: undefined, ms: undefined });
});

test("task_started falls back to task_type, then to 'task'; progress without history uses its own text", () => {
  const { out } = run([
    { type: "system", subtype: "task_started", task_id: "a", task_type: "bash", description: "d" },
    { type: "system", subtype: "task_started", task_id: "b", description: "d" },
    { type: "system", subtype: "task_progress", task_id: "c", description: "own", usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 } },
  ]);
  assert.deepEqual(out.map((e) => (e.kind === "task" ? e.type : "")), ["bash", "task", "task"]);
  assert.equal(out[2]!.kind === "task" && out[2]!.now, "own");
});

test("other system messages are ignored", () => {
  assert.deepEqual(run([{ type: "system", subtype: "status" }]).out, []);
});

test("assistant: text, tool calls and the activity of the main agent only", () => {
  const content = [{ type: "text", text: "hi" }, { type: "text", text: "  " }, { type: "tool_use", id: "x", name: "Bash", input: { a: 1 } }, { type: "thinking" }];
  const main = run([{ type: "assistant", parent_tool_use_id: null, message: { content } }]).out;
  assert.deepEqual(main.map((e) => e.kind), ["text", "tool", "activity"]);
  const sub = run([{ type: "assistant", parent_tool_use_id: "p", message: { content } }]).out;
  assert.deepEqual(sub.map((e) => e.kind), ["text", "tool"]);
  assert.equal(sub[0]!.kind === "text" && sub[0]!.sub, true);
});

test("user tool results: string, block and unknown content; long text is clipped; plain text messages skipped", () => {
  const long = "x".repeat(5000);
  const { out } = run([
    { type: "user", message: { content: "just text" } },
    {
      type: "user",
      message: {
        content: [
          { type: "text", text: "ignored" },
          { type: "tool_result", tool_use_id: "1", content: "ok" },
          { type: "tool_result", tool_use_id: "2", content: [{ type: "text", text: "a" }, { type: "image" }, {}], is_error: true },
          { type: "tool_result", tool_use_id: "3", content: long },
          { type: "tool_result", tool_use_id: "4", content: 42 },
        ],
      },
    },
  ]);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { kind: "tool_result", id: "1", text: "ok", isError: false });
  assert.deepEqual(out[1], { kind: "tool_result", id: "2", text: "a\n[image]\n", isError: true });
  assert.match((out[2] as { text: string }).text, /… \(\+1000 chars\)$/);
  assert.equal((out[3] as { text: string }).text, "");
});

test("result records cost and session id; failures report the subtype", () => {
  const s = { events: [] as Ev[], cost: 0 } as { events: Ev[]; sdkSessionId?: string; cost: number };
  const good = run([{ type: "result", subtype: "success", is_error: false, session_id: "s", total_cost_usd: 1.5, num_turns: 2, duration_ms: 30, result: "answer" }], s).out;
  assert.deepEqual(good, [{ kind: "result", cost: 1.5, turns: 2, ms: 30, ok: true, text: "answer" }]);
  assert.equal(s.cost, 1.5);
  assert.equal(s.sdkSessionId, "s");
  const bad = run([{ type: "result", subtype: "error_max_turns", session_id: "s", total_cost_usd: 2, num_turns: 9, duration_ms: 1 }]).out;
  assert.deepEqual(bad[0], { kind: "result", cost: 2, turns: 9, ms: 1, ok: false, text: "error_max_turns" });
  const errored = run([{ type: "result", subtype: "success", is_error: true, session_id: "s", total_cost_usd: 0, num_turns: 1, duration_ms: 1, result: "x" }]).out;
  assert.equal(errored[0]!.kind === "result" && errored[0]!.ok, false);
});

test("lastTask finds the newest event of a task", () => {
  const mk = (status: "running" | "completed"): Ev => ({ kind: "task", id: "t", type: "x", description: "", status });
  assert.equal(lastTask({ events: [mk("running"), { kind: "note", text: "n" }, mk("completed")] }, "t")?.status, "completed");
  assert.equal(lastTask({ events: [mk("running")] }, "nope"), null);
});
