// The in-process "work" MCP server the agent uses to report its progress (status.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkServer, WORK_NOTE, WORK_TOOL_PREFIX, type WorkStatus } from "../server/status.ts";

const handler = (onSet: (w: WorkStatus) => void) => {
  const server = createWorkServer(onSet) as unknown as { name: string; instance: { _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<any> }> } };
  return { name: server.name, call: (args: unknown) => server.instance._registeredTools.set_work_status!.handler(args, {}) };
};

test("set_work_status stores a cleaned status and answers with it", async () => {
  const seen: WorkStatus[] = [];
  const { name, call } = handler((w) => seen.push(w));
  assert.equal(name, "work");
  const res = await call({ status: "review", note: "  needs   a look " });
  assert.deepEqual(res, { content: [{ type: "text", text: "Status: review" }] });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.status, "review");
  assert.equal(seen[0]!.note, "needs a look");
});

test("an unknown status is an error result and nothing is stored", async () => {
  const seen: WorkStatus[] = [];
  const res = await handler((w) => seen.push(w)).call({ status: "wat" });
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, "Invalid status");
  assert.equal(seen.length, 0);
});

test("the prompt note names the tool whose prefix is auto-allowed", () => {
  assert.ok(WORK_NOTE.includes(`${WORK_TOOL_PREFIX}set_work_status`));
});
