// usage-gemini: sessions from Gemini CLI's chat JSONL files (no usage data is persisted, so
// sessions carry no tokens or cost), with HOME pointed at a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";

const home = tempDir("usage-gemini-home-");
process.env.HOME = home; // os.homedir() reads HOME on POSIX and USERPROFILE on Windows
process.env.USERPROFILE = home;
const { listGeminiSessions } = await import("../server/usage-gemini.ts");
const { listSessions, usageSummary } = await import("../server/usage.ts"); // registers the adapter

test("a missing tmp directory lists nothing, never throws", () => {
  const other = tempDir("usage-gemini-empty-");
  const up = process.env.USERPROFILE;
  const hm = process.env.HOME;
  process.env.USERPROFILE = other;
  process.env.HOME = other;
  try {
    assert.deepEqual(listGeminiSessions(7), []);
  } finally {
    process.env.USERPROFILE = up;
    process.env.HOME = hm;
  }
});

const jl = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const chats = join(home, ".gemini", "tmp", "shop-abc", "chats");
mkdirSync(chats, { recursive: true });
writeFileSync(join(home, ".gemini", "tmp", "shop-abc", ".project_root"), "C:/work/shop");

const A = "session-2026-10-17T05-05-aaaa.jsonl";
const start = new Date(Date.now() - 3_600_000).toISOString();
const end = new Date(Date.now() - 1_800_000).toISOString();
writeFileSync(
  join(chats, A),
  jl(
    { sessionId: "aaaa", projectHash: "abc", startTime: start, lastUpdated: end, kind: "main" },
    {
      $set: {
        messages: [
          { id: "m1", timestamp: start, type: "user", content: [{ text: "<session_context>env dump</session_context>" }] },
          { id: "m2", timestamp: end, type: "gemini", content: [{ text: "Sure, I will look." }] },
          { id: "m3", timestamp: end, type: "user", content: [{ text: "Fix the login" }] },
        ],
      },
    },
  ),
);
const OLD = "session-2026-09-01T05-05-bbbb.jsonl";
writeFileSync(
  join(chats, OLD),
  jl({ sessionId: "bbbb", projectHash: "abc", startTime: start, lastUpdated: end, kind: "main" }, { $set: { messages: [] } }),
);
const longAgo = new Date(Date.now() - 30 * 86_400_000);
utimesSync(join(chats, OLD), longAgo, longAgo);

// A project dir without .project_root falls back to the folder name.
const chats2 = join(home, ".gemini", "tmp", "misc-xyz", "chats");
mkdirSync(chats2, { recursive: true });
writeFileSync(join(chats2, "session-2026-10-17T06-00-cccc.jsonl"), jl({ sessionId: "cccc", projectHash: "xyz", startTime: start, lastUpdated: end, kind: "main" }));
const fresh = new Date();
utimesSync(join(chats, A), fresh, fresh);
utimesSync(join(chats2, "session-2026-10-17T06-00-cccc.jsonl"), fresh, fresh);

test("sessions are listed with no tokens, no cost and usage flagged unavailable", () => {
  const list = listGeminiSessions(7);
  const a = list.find((s) => s.id === "aaaa")!;
  assert.ok(a, "the recent chat is listed");
  assert.equal(a.provider, "gemini");
  assert.equal(a.usageAvailable, false, "gemini persists no usage: nothing to measure");
  assert.equal(a.project, "shop", "project comes from .project_root");
  assert.equal(a.title, "Fix the login", "the first plain user prompt, env dumps skipped");
  assert.equal(a.start, start);
  assert.equal(a.end, fresh.toISOString(), "the later of lastUpdated and the file mtime");
  assert.equal(a.total.cost, 0);
  assert.equal(a.total.input, 0);
  assert.equal(a.active, true, "the file was just touched");
  const c = list.find((s) => s.id === "cccc")!;
  assert.equal(c.project, "misc-xyz", "without .project_root the tmp folder name is the fallback");
  assert.equal(list.find((s) => s.id === "bbbb"), undefined, "older than the window");
});

test("the provider registers: listSessions and usageSummary see gemini sessions", () => {
  const list = listSessions(7, "gemini");
  assert.equal(list.length, 2);
  const bucket = usageSummary(7).byProvider.find((b) => b.key === "gemini")!;
  assert.ok(bucket, "byProvider includes gemini");
  assert.equal(bucket.count, 2);
  assert.equal(bucket.tokens.cost, 0, "sessions count, spend stays at zero");
});
