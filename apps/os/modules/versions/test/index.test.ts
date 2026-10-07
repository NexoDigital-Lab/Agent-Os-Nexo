// The versions routes: the builds list and pinning, over a throwaway os/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import register from "../server/index.ts";

const env = tempEnv();
for (const v of ["1.0.0", "1.0.1"]) mkdirSync(join(env.os, "versions", v), { recursive: true });
writeFileSync(join(env.os, "versions", "1.0.1", "build.json"), JSON.stringify({ builtAt: "2026-10-05T10:00:00Z", notes: "Fix" }));
const { call, get } = await mountModule(register, { env, version: "1.0.0" });

test("GET lists the builds, the running version and what loads next", async () => {
  const r = await get("/versions");
  assert.equal(r.status, 200);
  assert.equal(r.body.running, "1.0.0");
  assert.deepEqual(r.body.builds.map((b: { version: string }) => b.version), ["1.0.1", "1.0.0"]);
  assert.equal(r.body.builds[0].notes, "Fix");
  assert.equal(r.body.next, "1.0.1");
  assert.equal(r.body.pinned, null);
});

test("PUT pin pins a known build and null goes back to the newest", async () => {
  const pinned = await call("PUT", "/versions/pin", { version: "1.0.0" });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.pinned, "1.0.0");
  assert.equal(pinned.body.next, "1.0.0");
  assert.equal(readFileSync(join(env.os, "current"), "utf8"), "1.0.0\n");
  const cleared = await call("PUT", "/versions/pin", { version: null });
  assert.equal(cleared.body.pinned, null);
  assert.equal(cleared.body.next, "1.0.1");
});

test("PUT pin rejects an unknown build with 404 and a wrong body with 400", async () => {
  const unknown = await call("PUT", "/versions/pin", { version: "9.9.9" });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /No build 9\.9\.9/);
  assert.equal((await call("PUT", "/versions/pin", { version: 3 })).status, 400);
  assert.equal((await call("PUT", "/versions/pin", {})).status, 400);
});
