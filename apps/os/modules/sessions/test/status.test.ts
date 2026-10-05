import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, parseWorkStatus, trackWaiting } from "../server/status.ts";
import type { Ev } from "../server/sdkEvents.ts";

const base = { running: false, waiting: 0, end: null, unseen: false } as const;

test("idle by default", () => assert.equal(deriveStatus(base), "idle"));
test("running is working", () => assert.equal(deriveStatus({ ...base, running: true }), "working"));
test("a pending prompt while running needs the user", () => assert.equal(deriveStatus({ ...base, running: true, waiting: 1 }), "needs_you"));
test("finished OK and unseen is done", () => assert.equal(deriveStatus({ ...base, end: "ok", unseen: true }), "done"));
test("finished with error and unseen is error", () => assert.equal(deriveStatus({ ...base, end: "error", unseen: true }), "error"));
test("seen goes back to idle", () => {
  assert.equal(deriveStatus({ ...base, end: "ok", unseen: false }), "idle");
  assert.equal(deriveStatus({ ...base, end: "error", unseen: false }), "idle");
});
test("stopped by the user is idle even when unseen", () => assert.equal(deriveStatus({ ...base, end: null, unseen: true }), "idle"));
test("needs_you wins over done", () => assert.equal(deriveStatus({ ...base, waiting: 1, end: "ok", unseen: true }), "needs_you"));

test("trackWaiting follows permissions and module events that wait for the user", () => {
  const w = new Set<string>();
  const perm = { kind: "perm", id: "a", tool: "Bash", input: {} } as Ev;
  assert.equal(trackWaiting(w, perm), true);
  assert.equal(trackWaiting(w, perm), false);
  assert.equal(w.size, 1);
  assert.equal(trackWaiting(w, { kind: "perm_done", id: "a", allow: true }), true);
  assert.equal(w.size, 0);
  const plan: Ev = { kind: "module", module: "ssh", type: "plan", id: "p", waiting: true, data: {} };
  trackWaiting(w, plan);
  assert.equal(w.size, 1);
  assert.equal(trackWaiting(w, { kind: "module", module: "ssh", type: "plan", id: "q", data: {} }), false, "no waiting flag: not tracked");
  trackWaiting(w, { ...plan, waiting: false });
  assert.equal(w.size, 0);
  assert.equal(trackWaiting(w, { kind: "text", text: "hi", sub: false }), false);
});

test("parseWorkStatus validates and trims", () => {
  assert.equal(parseWorkStatus("nope", "x"), null);
  const w = parseWorkStatus("doing", "  hola \n mundo ", 5)!;
  assert.deepEqual(w, { status: "doing", note: "hola mundo", at: 5 });
  assert.equal(parseWorkStatus("done", "x".repeat(300))!.note.length, 120);
  assert.equal(parseWorkStatus("done", undefined)!.note, "");
  assert.equal(parseWorkStatus("en curso", "x"), null, "the old Spanish values are gone");
});
