import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addToInbox, initData, logSession, readDoc, todayCost, writeDoc } from "../server/data.ts";

const root = mkdtempSync(join(tmpdir(), "agent-os-home-"));
after(() => rmSync(root, { recursive: true, force: true }));
initData({ data: join(root, "data"), state: join(root, "state") });

test("turns are logged and their cost adds up for today", () => {
  assert.equal(todayCost(), 0);
  logSession({ project: "shop", prompt: "add\nlogin", skills: ["nexo-dev"], cost: 0.25, turns: 3, ok: true });
  logSession({ project: "", prompt: "x", skills: [], cost: 0.5, turns: 1, ok: false });
  assert.equal(todayCost(), 0.75);
  const log = readDoc("log");
  assert.match(log, /\*\*shop\*\* · ok · \$0\.250 · 3 turns — add login \[nexo-dev\]/);
  assert.match(log, /\*\*—\*\* · error/);
});

test("inbox and goals live in the data folder", () => {
  addToInbox("call the bank", "shop");
  assert.match(readDoc("inbox"), /^# Inbox\n\n- \[ \] \d{4}-\d\d-\d\d \*\*shop\*\* — call the bank\n$/);
  writeDoc("goals", "# Q4\n- ship");
  assert.equal(readDoc("goals"), "# Q4\n- ship");
});
