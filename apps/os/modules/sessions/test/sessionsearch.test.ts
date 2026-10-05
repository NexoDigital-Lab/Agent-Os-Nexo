import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIndex, toMatch } from "../server/sessionsearch.ts";

const line = (o: object) => JSON.stringify(o) + "\n";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ss-"));
  const pd = path.join(dir, "proj");
  mkdirSync(pd);
  writeFileSync(
    path.join(pd, `${A}.jsonl`),
    line({ type: "user", cwd: "/x/demo", timestamp: "2026-01-01T00:00:01Z", message: { content: "¿Cómo configuro la autenticación <b>JWT</b>?" } }) +
      line({ type: "assistant", timestamp: "2026-01-01T00:00:02Z", message: { id: "m1", content: [{ type: "text", text: "Usá la autenticación con refresh tokens. key=AKIAABCDEFGHIJKLMNOP" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/secret" } }] } }) +
      line({ type: "user", isSidechain: true, timestamp: "2026-01-01T00:00:03Z", message: { content: "sidechain autenticación" } }),
  );
  writeFileSync(path.join(pd, `${B}.jsonl`), line({ type: "user", cwd: "/x/other", timestamp: "2026-01-02T00:00:00Z", message: { content: "migración de postgres" } }));
  return { dir, pd, idx: createIndex({ dbPath: path.join(dir, "s.db"), projectsDir: dir }) };
}

test("toMatch quotes words and prefixes the last", () => {
  assert.equal(toMatch('foo "bar" NEAR('), '"foo" "bar" "NEAR"*');
  assert.equal(toMatch("***"), null);
});

test("search: diacritics, dedupe, escaping, redaction, sidechain skipped", async () => {
  const { dir, idx } = setup();
  const r = await idx.search("autenticacion");
  assert.equal(r.length, 1);
  assert.equal(r[0].sessionId, A);
  assert.equal(r[0].hits, 2);
  assert.equal(r[0].project, "demo");
  assert.match(r[0].snippet, /<mark>/);
  const jwt = await idx.search("JWT");
  assert.ok(jwt[0].snippet.includes("&lt;b&gt;"), jwt[0].snippet);
  assert.ok(!jwt[0].snippet.includes("<b>"));
  assert.equal((await idx.search("AKIAABCDEFGHIJKLMNOP")).length, 0);
  assert.equal((await idx.search("sidechain")).length, 0);
  assert.equal((await idx.search("autenticacion", { project: "other" })).length, 0);
  assert.equal(idx.stats().sessions, 2);
  idx.close();
  rmSync(dir, { recursive: true });
});

test("trigram fallback finds substrings; around gives context; incremental reindex", async () => {
  const { dir, pd, idx } = setup();
  assert.equal((await idx.search("igrac"))[0]?.sessionId, B);
  const ctx = await idx.around(A, "2026-01-01T00:00:02Z", 1);
  assert.ok(ctx.length >= 2 && ctx.some((m) => m.match));
  appendFileSync(path.join(pd, `${B}.jsonl`), line({ type: "assistant", timestamp: "2026-01-02T00:00:05Z", message: { id: "m9", content: [{ type: "text", text: "usá pgbouncer" }] } }));
  await idx.ensure(true);
  assert.equal((await idx.search("pgbouncer"))[0]?.sessionId, B);
  rmSync(path.join(pd, `${B}.jsonl`));
  await idx.ensure(true);
  assert.equal(idx.stats().sessions, 1);
  idx.close();
  rmSync(dir, { recursive: true });
});
