// usage-opencode: per-session aggregates from OpenCode's SQLite store (session_v2), with HOME
// pointed at a temp folder holding a fixture database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";

const home = tempDir("usage-opencode-home-");
process.env.HOME = home; // os.homedir() reads HOME on POSIX and USERPROFILE on Windows
process.env.USERPROFILE = home;
const { listOpencodeSessions } = await import("../server/usage-opencode.ts");
const { listSessions, usageSummary } = await import("../server/usage.ts"); // registers the adapter

test("a missing database lists nothing, never throws", () => {
  const other = tempDir("usage-opencode-empty-");
  const up = process.env.USERPROFILE;
  const hm = process.env.HOME;
  process.env.USERPROFILE = other;
  process.env.HOME = other;
  try {
    assert.deepEqual(listOpencodeSessions(7), []);
  } finally {
    process.env.USERPROFILE = up;
    process.env.HOME = hm;
  }
});

const NOW = Date.now();
const HOUR = 3_600_000;
const MAIN = "ses_main000000000000000000000000";
const CHILD = "ses_child00000000000000000000000";
const ORPHAN = "ses_orphan0000000000000000000000";
const OLD = "ses_old0000000000000000000000000";
const IDLE = "ses_idle000000000000000000000000";

const dbPath = join(home, ".local", "share", "opencode", "opencode.db");
mkdirSync(dirname(dbPath), { recursive: true });
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(dbPath);
db.exec(
  `CREATE TABLE session_v2 (id TEXT, parent_id TEXT, title TEXT, directory TEXT, cost REAL,
   tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER,
   tokens_cache_write INTEGER, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER)`,
);
const insert = db.prepare(
  `INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const model = JSON.stringify({ id: "mimo-v2.5", providerID: "opencode-go" });
insert.run(MAIN, null, "Verify the project", "C:/work/shop/code", 3.5, 1_000_000, 200_000, 10_000, 4_000_000, 0, "gentle-orchestrator", model, NOW - 2 * HOUR, NOW - HOUR);
insert.run(CHILD, MAIN, null, "C:/work/shop/code", 0.5, 100_000, 50_000, 0, 500_000, 0, "gentle-worker", model, NOW - HOUR, NOW - 30 * 60_000);
insert.run(ORPHAN, "ses_missing00000000000000000000", "Orphan run", "C:/work/elsewhere", 0.25, 10_000, 5_000, 0, 0, 0, null, "plain-string-model", NOW - 3 * HOUR, NOW - 2 * HOUR);
insert.run(OLD, null, "Ancient", "C:/work/shop/code", 9, 1, 1, 0, 0, 0, null, model, NOW - 30 * 86_400_000, NOW - 29 * 86_400_000);
insert.run(IDLE, null, "Idle", "C:/work/shop/code", 0, 0, 0, 0, 0, 0, null, model, NOW - 5 * 86_400_000, NOW - 4 * 86_400_000);
// A second child with no agent, a model JSON without id, and its own model bucket.
insert.run("ses_child20000000000000000000000", MAIN, null, "C:/work/shop/code", 0.25, 10_000, 5_000, 0, 0, 0, null, JSON.stringify({ providerID: "opencode-go" }), NOW - HOUR, NOW - 45 * 60_000);
// No directory, no title, no model, fresh with zero cost: kept because it is live.
insert.run("ses_bare000000000000000000000000", null, null, null, 0, 0, 0, 0, 0, 0, null, null, NOW - HOUR, NOW);
// No timestamps at all, but real cost: kept by cost, never live.
insert.run("ses_notime00000000000000000000000", null, "No time", "C:/work/shop/code", 9, 1_000_000, 0, 0, 0, 0, null, model, null, null);
db.close();

test("sessions carry opencode's own cost, tokens, model and agent; children become AgentRuns", () => {
  const list = listOpencodeSessions(7);
  const main = list.find((s) => s.id === MAIN)!;
  assert.ok(main, "the parent session is listed");
  assert.equal(main.provider, "opencode");
  assert.equal(main.usageAvailable, true);
  assert.equal(main.title, "Verify the project");
  assert.equal(main.project, "code", "project = the directory's folder name");
  assert.equal(main.source, "opencode");
  assert.equal(main.main.cost, 3.5, "cost is opencode's own USD figure");
  assert.equal(main.main.input, 1_000_000);
  assert.equal(main.main.cacheRead, 4_000_000);
  assert.deepEqual(main.mainModels, ["mimo-v2.5"], "the model JSON is unwrapped to its id");
  assert.equal(main.active, false, "last touch was half an hour ago, outside the 90 s live window");
  assert.ok(main.total.cost > 0, "kept because it has cost, not because it is active");
  assert.equal(main.agents.length, 2);
  const child = main.agents[0]!;
  assert.equal(child.agentId, CHILD);
  assert.equal(child.type, "gentle-worker");
  assert.equal(child.tokens.cost, 0.5);
  assert.equal(main.total.cost, 4.25, "parent + two children");
  assert.equal(main.byModel["mimo-v2.5"]!.input, 1_100_000);
  const child2 = main.agents.find((a) => a.agentId === "ses_child20000000000000000000000")!;
  assert.equal(child2.type, "subagent", "no agent name falls back to subagent");
  assert.ok(main.byModel[JSON.stringify({ providerID: "opencode-go" })], "a model JSON without id stays raw and gets its own bucket");
  const bare = list.find((s) => s.id === "ses_bare000000000000000000000000")!;
  assert.equal(bare.project, "?", "no directory at all");
  assert.equal(bare.title, bare.id, "no title falls back to the id");
  assert.deepEqual(bare.mainModels, ["?"], "no model at all");
  assert.equal(bare.active, true, "zero cost but live: still listed");
  const notime = list.find((s) => s.id === "ses_notime00000000000000000000000")!;
  assert.equal(notime.start, null, "no timestamps stay null");
  assert.equal(notime.end, null);
  assert.equal(notime.active, false);
  assert.ok(notime.total.cost > 0, "zero timestamps but real cost: listed");
  const orphan = list.find((s) => s.id === ORPHAN)!;
  assert.ok(orphan, "a child whose parent is outside the window stands alone");
  assert.equal(orphan.agents.length, 0);
  assert.deepEqual(orphan.mainModels, ["plain-string-model"], "a model that is not JSON stays as-is");
  assert.equal(list.find((s) => s.id === OLD), undefined, "older than the window");
  assert.equal(list.find((s) => s.id === IDLE), undefined, "costless and idle is dropped");
});

test("the provider registers: listSessions and usageSummary see opencode sessions", () => {
  const list = listSessions(7, "opencode");
  assert.ok(list.some((s) => s.id === MAIN));
  assert.ok(!listSessions(7, "claude").some((s) => s.id === MAIN));
  const sum = usageSummary(7);
  const bucket = sum.byProvider.find((b) => b.key === "opencode")!;
  assert.ok(bucket, "byProvider includes opencode once the adapter is registered");
  assert.ok(Math.abs(bucket.tokens.cost - 13.5) < 1e-9, "main 4.25 + orphan 0.25 + notime 9");
  assert.equal(bucket.count, 4, "main, orphan, bare and notime");
});

test("a corrupt database lists nothing instead of crashing", () => {
  const other = tempDir("usage-opencode-broken-");
  const brokenDb = join(other, ".local", "share", "opencode", "opencode.db");
  mkdirSync(dirname(brokenDb), { recursive: true });
  writeFileSync(brokenDb, "this is not sqlite");
  const up = process.env.USERPROFILE;
  const hm = process.env.HOME;
  process.env.USERPROFILE = other;
  process.env.HOME = other;
  try {
    assert.deepEqual(listOpencodeSessions(7), []);
  } finally {
    process.env.USERPROFILE = up;
    process.env.HOME = hm;
  }
});
