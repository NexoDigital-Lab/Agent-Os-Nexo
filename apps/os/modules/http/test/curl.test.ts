import { test } from "node:test";
import assert from "node:assert/strict";
import { send } from "../server/client.ts";

test("send refuses non-http URLs and reports network failures as results", async () => {
  await assert.rejects(send({ method: "GET", url: "file:///etc/passwd", headers: [] }), /Only http/);
  await assert.rejects(send({ method: "GET", url: "not a url", headers: [] }), /Invalid URL/);
  const r = await send({ method: "GET", url: "http://127.0.0.1:9/", headers: [] });
  assert.equal(r.ok, false);
});
