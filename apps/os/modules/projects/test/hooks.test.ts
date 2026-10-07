// The hook registry: hooks run in registration order and are exposed read-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addProjectHooks, projectHooks } from "../server/hooks.ts";

test("registered hooks are returned in order and accumulate", () => {
  const before = projectHooks().length;
  const a = { deleteFacts: () => ({ openTabs: 1 }) };
  const b = { beforeLocalDelete: () => undefined };
  addProjectHooks(a);
  addProjectHooks(b);
  assert.equal(projectHooks().length, before + 2);
  assert.deepEqual(projectHooks().slice(-2), [a, b]);
  assert.deepEqual(projectHooks()[before]!.deleteFacts!({} as never), { openTabs: 1 });
});
