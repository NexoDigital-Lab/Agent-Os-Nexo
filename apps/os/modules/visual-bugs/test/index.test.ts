// The visual-bugs routes: upload a screenshot, list, serve, annotate, delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mountModule } from "../../../host/test/harness.ts";
import register from "../server/index.ts";

const { base, call, get, ctx } = await mountModule(register);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const upload = async (body: Uint8Array | string, type: string) => {
  const res = await fetch(`${base}/visual-bugs`, { method: "POST", headers: { "content-type": type }, body: body as BodyInit });
  return { status: res.status, body: (await res.json()) as any };
};

test("starts empty", async () => {
  assert.deepEqual((await get("/visual-bugs")).body, []);
});

test("rejects an empty body and an unsupported format", async () => {
  assert.equal((await upload(Buffer.alloc(0), "image/png")).status, 415);
  assert.equal((await upload("<svg/>", "image/svg+xml")).status, 415);
  assert.equal((await upload("{}", "application/json")).status, 415);
});

test("a screenshot is stored, listed and served with safe headers", async () => {
  const saved = await upload(png, "IMAGE/PNG; charset=binary");
  assert.equal(saved.status, 200);
  assert.match(saved.body.name, /^bug-\d{8}-\d{6}-1\.png$/);
  assert.equal(existsSync(saved.body.file), true);
  assert.equal((await get("/visual-bugs")).body[0].name, saved.body.name);
  const res = await fetch(`${base}/visual-bugs/${saved.body.name}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
});

test("unknown or malformed names are 404", async () => {
  assert.equal((await fetch(`${base}/visual-bugs/bug-20200101-000000-9.png`)).status, 404);
  assert.equal((await fetch(`${base}/visual-bugs/..%2Findex.json`)).status, 404);
  assert.equal((await fetch(`${base}/visual-bugs/notes.txt`)).status, 404);
});

test("notes are validated, trimmed and capped", async () => {
  const { name } = (await get("/visual-bugs")).body[0];
  assert.equal((await call("PATCH", `/visual-bugs/${name}`, { note: 5 })).status, 400);
  assert.equal((await call("PATCH", `/visual-bugs/${name}`, {})).status, 400);
  assert.equal((await call("PATCH", "/visual-bugs/bug-20200101-000000-9.png", { note: "x" })).status, 404);
  assert.deepEqual((await call("PATCH", `/visual-bugs/${name}`, { note: `  button clipped  ` })).body, { ok: true });
  assert.equal((await get("/visual-bugs")).body[0].note, "button clipped");
  await call("PATCH", `/visual-bugs/${name}`, { note: "y".repeat(3000) });
  assert.equal((await get("/visual-bugs")).body[0].note.length, 2000);
});

test("delete removes the file and the entry; deleting again is harmless", async () => {
  const second = await upload(png, "image/jpeg");
  assert.match(second.body.name, /\.jpg$/);
  assert.equal((await get("/visual-bugs")).body.length, 2);
  assert.deepEqual((await call("DELETE", `/visual-bugs/${second.body.name}`)).body, { ok: true });
  assert.equal(existsSync(second.body.file), false);
  assert.equal((await get("/visual-bugs")).body.length, 1);
  assert.deepEqual((await call("DELETE", `/visual-bugs/${second.body.name}`)).body, { ok: true });
  assert.equal(typeof ctx.dataDir, "string");
});
