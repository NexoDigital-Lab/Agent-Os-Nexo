import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSendBody } from "../server/sendBody.ts";

test("a valid send body passes, with defaults", () => {
  assert.deepEqual(parseSendBody({ prompt: "hi" }), { prompt: "hi", skills: [], images: [], mode: "default", model: undefined, workMode: undefined });
  const full = parseSendBody({ prompt: "x", skills: ["nexo-dev"], images: ["a1.png"], mode: "plan", model: "sonnet", workMode: "focus" });
  assert.equal(full.mode, "plan");
  assert.equal(full.workMode, "focus");
});

test("a malformed send body is refused before the tab changes", () => {
  for (const [body, re] of [
    [{}, /prompt must be non-empty/],
    [{ prompt: "  " }, /prompt must be non-empty/],
    [{ prompt: "x", images: "a" }, /images must be a list/],
    [{ prompt: "x", skills: [{}] }, /skills must be a list/],
    [{ prompt: "x", images: ["../../etc/passwd"] }, /images must be a list/],
    [{ prompt: "x", mode: "yolo" }, /mode must be one of/],
    [{ prompt: "x", workMode: "turbo" }, /workMode must be one of/],
    [{ prompt: "x", model: "a b" }, /Invalid model/],
    [{ prompt: "x".repeat(100_001) }, /longer than/],
  ] as const) {
    assert.throws(() => parseSendBody(body), re, JSON.stringify(body).slice(0, 60));
  }
});
