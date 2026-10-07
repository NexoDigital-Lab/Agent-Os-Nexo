// The monitor routes and the probe / local-transcript paths of limits.ts, with HOME pointed at a temp folder and the
// SDK replaced by a canned /usage answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempDir } from "../../../host/test/harness.ts";

const home = tempDir("agent-os-home-");
process.env.HOME = home; // os.homedir() reads HOME on POSIX and USERPROFILE on Windows
process.env.USERPROFILE = home;
const proj = join(home, ".claude", "projects", "-work-shop");
mkdirSync(join(proj, "abc", "subagents"), { recursive: true });
const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const line = (id: string, model: string, ts: string, out: number) =>
  JSON.stringify({ type: "assistant", timestamp: ts, uuid: `u-${id}`, message: { id, model, usage: { input_tokens: 1000, output_tokens: out } } });
writeFileSync(
  join(proj, "abc.jsonl"),
  [
    line("m1", "claude-sonnet-4-5", hours(1), 2000),
    line("m1", "claude-sonnet-4-5", hours(1), 2000), // the same message repeated by a resumed session
    line("m2", "claude-sonnet-4-5", hours(30), 1000),
    line("old", "claude-sonnet-4-5", hours(24 * 10), 1000), // older than the weekly window
    line("syn", "<synthetic>", hours(1), 1000),
    "not json but has \"usage\"",
    JSON.stringify({ type: "user", timestamp: hours(1), message: { usage: {} } }),
  ].join("\n") + "\n",
);
writeFileSync(join(proj, "abc", "subagents", "agent-1.jsonl"), line("s1", "claude-haiku-4-5", hours(2), 500) + "\n");
writeFileSync(join(proj, "ignored.txt"), "x");
mkdirSync(join(proj, "nodots"), { recursive: true }); // a folder without subagents/
mkdirSync(join(home, ".claude", "projects", "-empty"), { recursive: true });
const fresh = new Date();
for (const f of [join(proj, "abc.jsonl"), join(proj, "abc", "subagents", "agent-1.jsonl")]) utimesSync(f, fresh, fresh);

const { default: register } = await import("../server/index.ts");
const { deps, limits, localPoints, probe, windows, WINDOWS } = await import("../server/limits.ts");

let usageCalls = 0;
let usageAnswer: unknown = {
  subscription_type: "max",
  rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 42, resets_at: new Date(Date.now() + 3_600_000).toISOString() }, seven_day: { utilization: 10, resets_at: null } },
};
deps.query = ((_args: unknown) => ({
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
    usageCalls++;
    if (usageAnswer instanceof Error) throw usageAnswer;
    return usageAnswer;
  },
})) as unknown as typeof deps.query;

const { get, ctx } = await mountModule(register);

test("a rate_limit_event of any turn feeds the plan meter", async () => {
  const { contributions } = await import("../../sessions/server/contributions.ts");
  const onMessage = contributions().map((c) => c.onMessage).find(Boolean)!;
  const tab = { id: "t", title: "", project: "", dir: "", cwd: "", worktree: null, meta: {} };
  onMessage(tab, { type: "assistant" } as never);
  onMessage(tab, { type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", utilization: 0.77, resetsAt: Date.now() / 1000 + 3600 } } as never);
  const five = windows(localPoints()).find((w) => w.id === "five_hour")!;
  assert.equal(five.pct, 77);
  assert.equal(five.source, "plan");
});


test("local points count each message once, only inside the weekly window, ignoring synthetic and broken lines", () => {
  const pts = localPoints();
  // m1 (once), m2 and the subagent's s1: 3 points, oldest first
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map((p) => p[0]), [...pts.map((p) => p[0])].sort((a, b) => a - b));
  const sonnetCost = (1000 * 3 + 2000 * 15) / 1e6;
  assert.ok(Math.abs(pts.reduce((a, p) => a + p[2], 0) - (sonnetCost + (1000 * 3 + 1000 * 15) / 1e6 + (1000 * 1 + 500 * 5) / 1e6)) < 1e-9);
  assert.equal(localPoints(Date.now() + 1).length, 3, "a second pass is served from the cache");
  assert.equal(localPoints(Date.now() + WINDOWS.seven_day + 3_600_000).length, 0, "transcripts untouched for a week are skipped");
});

test("limits() probes the CLI once, reports plan windows and a plan is known", async () => {
  const r = await limits();
  assert.equal(usageCalls, 1);
  assert.equal(r.subscription, "max");
  assert.equal(r.planAvailable, true);
  const five = r.windows.find((w) => w.id === "five_hour")!;
  assert.equal(five.pct, 42);
  assert.equal(five.source, "plan");
  assert.equal(five.messages, 2); // m1 and s1 in the last 5 h
  await limits();
  assert.equal(usageCalls, 1, "probing again within 5 minutes does nothing");
});

test("a failed or concurrent probe is harmless", async () => {
  usageAnswer = new Error("no CLI");
  await probe(true); // the failure is swallowed
  assert.equal(usageCalls, 2);
  usageAnswer = { subscription_type: "api", rate_limits_available: false, rate_limits: null };
  const [a, b] = [probe(true), probe(true)];
  assert.equal(a, b, "a probe already running is shared");
  await a;
  assert.equal(usageCalls, 3);
});

test("the routes report limits and the usage of the transcripts", async () => {
  const lim = await get("/limits");
  assert.equal(lim.status, 200);
  assert.equal(lim.body.planAvailable, false);
  assert.equal(lim.body.windows.length, 2);
  const sum = await get("/usage/summary?days=3");
  assert.equal(sum.status, 200);
  assert.equal(sum.body.days, 3);
  assert.equal(sum.body.sessions, 1);
  assert.deepEqual(sum.body.byAgent.map((a: { key: string }) => a.key).sort(), ["main", "subagent"]);
  const list = await get("/usage/sessions");
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, "abc");
  assert.equal(list.body[0].agents.length, 1);
  assert.equal(typeof ctx.id, "string");
});

