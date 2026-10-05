import { test } from "node:test";
import assert from "node:assert/strict";
import { noteRateLimit, noteUsage, toPct, windows } from "../server/limits.ts";

const now = Date.parse("2026-10-01T12:00:00Z");
const H = 3_600_000;

test("toPct: usage endpoint is already a percent, events may be a fraction", () => {
  assert.equal(toPct(0.5, true), 50);
  assert.equal(toPct(83, true), 83);
  assert.equal(toPct(0.5, false), 0.5);
  assert.equal(toPct(140, false), 100);
});

test("local windows sum only the points inside each window; reset is first point + span", () => {
  const pts: [number, number, number][] = [
    [now - 6 * H, 100, 1], // outside 5 h, inside 7 d
    [now - 3 * H, 200, 2],
    [now - 1 * H, 300, 3],
  ];
  const [five, week] = windows(pts, now);
  assert.equal(five.pct, null);
  assert.equal(five.source, "local");
  assert.equal(five.tokens, 500);
  assert.equal(five.cost, 5);
  assert.equal(five.resetsAt, now - 3 * H + 5 * H);
  assert.equal(week.tokens, 600);
});

test("plan data wins over local, and a window that already reset is dropped", () => {
  noteUsage({ subscription_type: "max", rate_limits_available: true, rate_limits: { five_hour: { utilization: 82, resets_at: new Date(now + H).toISOString() }, seven_day: { utilization: 40, resets_at: new Date(now - H).toISOString() } } } as never, now);
  const [five, week] = windows([], now);
  assert.equal(five.pct, 82);
  assert.equal(five.source, "plan");
  assert.equal(week.pct, null); // stale: its reset time is in the past
});

test("rate_limit_event feeds the same store (resetsAt is epoch seconds)", () => {
  noteRateLimit({ rateLimitType: "seven_day", utilization: 0.9, resetsAt: (now + 2 * H) / 1000 }, now + 10 * 60_000);
  const [, week] = windows([], now);
  assert.equal(week.pct, 90);
  assert.equal(week.resetsAt, now + 2 * H);
});
