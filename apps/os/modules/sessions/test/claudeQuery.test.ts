// structured() and ask(): the read-only one-shot queries, run against a fake SDK stream; plus the confine hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ask, confineHook, MODEL, READ_ONLY, structured, type QueryFn } from "../server/claude.ts";

const fake = (msgs: unknown[], seen: any[] = []): QueryFn =>
  ((args: unknown) => {
    seen.push(args);
    return (async function* () {
      for (const m of msgs) yield m;
    })();
  }) as unknown as QueryFn;

const cwd = mkdtempSync(path.join(os.tmpdir(), "claude-q-"));
mkdirSync(path.join(cwd, "src"));

test("structured returns the validated output and cost, asking for json_schema read-only", async () => {
  const seen: any[] = [];
  const r = await structured<{ a: number }>("p", cwd, { type: "object" }, ["/x"], fake([{ type: "system" }, { type: "result", subtype: "success", total_cost_usd: 0.25, structured_output: { a: 1 } }], seen));
  assert.deepEqual(r, { out: { a: 1 }, cost: 0.25 });
  const o = seen[0].options;
  assert.equal(seen[0].prompt, "p");
  assert.equal(o.model, MODEL);
  assert.deepEqual(o.tools, READ_ONLY);
  assert.deepEqual(o.additionalDirectories, ["/x"]);
  assert.equal(o.persistSession, false);
  assert.deepEqual(o.outputFormat, { type: "json_schema", schema: { type: "object" } });
});

test("structured: an error result becomes a 502 naming the subtype; no result says so", async () => {
  await assert.rejects(structured("p", cwd, {}, [], fake([{ type: "result", subtype: "error_max_turns", total_cost_usd: 1 }])), (e: any) => e.status === 502 && /error_max_turns/.test(e.message));
  await assert.rejects(structured("p", cwd, {}, [], fake([])), (e: any) => e.status === 502 && /no output/.test(e.message));
});

test("ask returns trimmed text with a custom system prompt", async () => {
  const seen: any[] = [];
  const r = await ask("q", "be brief", cwd, fake([{ type: "result", subtype: "success", total_cost_usd: 0.5, result: "  hello \n" }], seen));
  assert.deepEqual(r, { text: "hello", cost: 0.5 });
  assert.equal(seen[0].options.systemPrompt, "be brief");
  assert.equal(seen[0].options.maxTurns, 20);
});

test("ask: empty answer or error result is a 502", async () => {
  await assert.rejects(ask("q", "s", cwd, fake([{ type: "result", subtype: "success", total_cost_usd: 0, result: "  " }])), (e: any) => e.status === 502 && /no output/.test(e.message));
  await assert.rejects(ask("q", "s", cwd, fake([{ type: "result", subtype: "error_during_execution", total_cost_usd: 0 }])), (e: any) => /error_during_execution/.test(e.message));
});

test("confineHook allows reads inside the project and denies outside paths, '..' globs, and other events", async () => {
  const hook = confineHook(cwd);
  assert.equal(hook.matcher, "Read|Glob|Grep");
  const run = (input: Record<string, unknown>) => (hook.hooks[0] as any)(input, undefined, { signal: new AbortController().signal });
  const pre = (tool_name: string, tool_input?: unknown) => ({ hook_event_name: "PreToolUse", tool_name, tool_input });
  assert.deepEqual(await run(pre("Read", { file_path: path.join(cwd, "src", "a.ts") })), {});
  assert.deepEqual(await run(pre("Read")), {}, "no input at all touches no path");
  const denied = await run(pre("Read", { file_path: path.join(os.tmpdir(), "elsewhere", "x") }));
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.equal((await run(pre("Glob", { pattern: "../**" }))).hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(await run({ hook_event_name: "PostToolUse", tool_name: "Read" }), {});
});
