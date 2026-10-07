// contributions: registration, per-event hook merging, and safely() containing a broken module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contributeToSessions, contributions, mergedHooks, safely } from "../server/contributions.ts";

test("contributions are kept in registration order", () => {
  const a = { promptNote: () => "a" };
  const b = { promptNote: () => "b" };
  contributeToSessions(a);
  contributeToSessions(b);
  assert.deepEqual(contributions().slice(-2), [a, b]);
});

test("mergedHooks concatenates matchers per event across contributions", () => {
  const m1 = { matcher: "Bash", hooks: [] };
  const m2 = { matcher: "Read", hooks: [] };
  const m3 = { matcher: "*", hooks: [] };
  contributeToSessions({ hooks: { PreToolUse: [m1], Stop: [m3] } });
  contributeToSessions({ hooks: { PreToolUse: [m2], PostToolUse: undefined } });
  const merged = mergedHooks();
  assert.deepEqual(merged.PreToolUse?.slice(-2), [m1, m2]);
  assert.deepEqual(merged.Stop, [m3]);
  assert.deepEqual(merged.PostToolUse, [], "an undefined list adds nothing");
});

test("safely returns the value, or the fallback when the callback throws", () => {
  assert.equal(safely(() => 7, 0), 7);
  const err = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    assert.equal(safely(() => { throw new Error("boom"); }, "fallback"), "fallback");
  } finally {
    console.error = err;
  }
  assert.equal(logged.length, 1);
  assert.match(String(logged[0]![0]), /contribution failed/);
});
