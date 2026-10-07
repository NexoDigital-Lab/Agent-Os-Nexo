// The home routes (goals, inbox, today's log) and the turn log that sessions feed through contributeToSessions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule } from "../../../host/test/harness.ts";
import { contributions } from "../../sessions/server/contributions.ts";
import register from "../server/index.ts";

const { call, get, ctx } = await mountModule(register);

test("an unknown document is a 404 and only inbox and goals can be written", async () => {
  assert.equal((await get("/home/secrets")).status, 404);
  assert.equal((await call("PUT", "/home/log", { text: "x" })).status, 400);
  assert.equal((await call("PUT", "/home/other", { text: "x" })).status, 400);
});

test("goals are saved as given and read back with today's cost", async () => {
  assert.deepEqual((await get("/home/goals")).body, { text: "", todayCost: 0 });
  assert.deepEqual((await call("PUT", "/home/goals", { text: "# Goals\n- ship\n" })).body, { ok: true });
  assert.equal((await get("/home/goals")).body.text, "# Goals\n- ship\n");
  assert.equal(readFileSync(join(ctx.dataDir, "goals.md"), "utf8"), "# Goals\n- ship\n");
  await call("PUT", "/home/goals", {});
  assert.equal((await get("/home/goals")).body.text, "", "a missing text empties it");
});

test("the inbox collects one line per item, with the project when given", async () => {
  await call("POST", "/home/inbox", { text: "call the bank\nafter lunch" });
  await call("POST", "/home/inbox", { text: "fix login", project: "shop" });
  const text: string = (await get("/home/inbox")).body.text;
  assert.match(text, /^# Inbox\n\n- \[ \] \d{4}-\d\d-\d\d call the bank after lunch\n- \[ \] \d{4}-\d\d-\d\d \*\*shop\*\* — fix login\n$/);
  await call("PUT", "/home/inbox", { text: "- [ ] rewritten\n" });
  assert.equal((await get("/home/inbox")).body.text, "- [ ] rewritten\n");
});

test("each finished turn is logged and its cost counted for today", async () => {
  const onTurnEnd = contributions().map((c) => c.onTurnEnd).find(Boolean)!;
  const tab = { id: "t", title: "", project: "shop", dir: "", cwd: "", worktree: null, meta: {} };
  onTurnEnd(tab, { prompt: "add   a\ncart", skills: ["quick"], cost: 0.25, turns: 3, ok: true });
  onTurnEnd({ ...tab, project: "" }, { prompt: "oops", skills: [], cost: 0.5, turns: 1, ok: false });
  const r = await get("/home/log");
  assert.equal(r.body.todayCost, 0.75);
  assert.match(r.body.text, /\*\*shop\*\* · ok · \$0\.250 · 3 turns — add a cart \[quick\]/);
  assert.match(r.body.text, /\*\*—\*\* · error · \$0\.500 · 1 turns — oops\n/);
});
