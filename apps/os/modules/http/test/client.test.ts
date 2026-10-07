// The HTTP client's sender against a local server, and its store and routes.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mountModule } from "../../../host/test/harness.ts";
import register from "../server/index.ts";
import { initStore, readStore, send, writeStore } from "../server/client.ts";

const MB = 1024 * 1024;
const target = createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (url.pathname === "/redirect") return void res.writeHead(302, { location: "/echo" }).end();
    if (url.pathname === "/big") return void res.writeHead(200, { "content-length": String(3 * MB) }).end(Buffer.alloc(3 * MB, "a"));
    if (url.pathname === "/big-chunked") {
      res.writeHead(200);
      for (let i = 0; i < 3; i++) res.write(Buffer.alloc(MB, "b"));
      return void res.end();
    }
    if (url.pathname === "/empty") return void res.writeHead(204).end();
    if (url.pathname === "/teapot") return void res.writeHead(418, "I am a teapot").end("short and stout");
    res.writeHead(200, { "content-type": "application/json", "x-seen": String(req.headers["x-test"] ?? "") });
    res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString() }));
  });
});
await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
after(() => (target.closeAllConnections(), target.close()));
const origin = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
const req = (path: string, extra: Partial<Parameters<typeof send>[0]> = {}) => send({ method: "GET", url: origin + path, headers: [], ...extra });

test("send returns status, headers, timing and the body", async () => {
  const r = await req("/echo", { method: "post", headers: [["x-test", "yes"]], body: '{"a":1}' });
  assert.ok(r.ok);
  assert.equal(r.status, 200);
  assert.equal(r.statusText, "OK");
  assert.deepEqual(JSON.parse(r.body), { method: "POST", body: '{"a":1}' });
  assert.equal(r.size, Buffer.byteLength(r.body));
  assert.ok(r.headers.some(([k, v]) => k === "x-seen" && v === "yes"));
  assert.ok(r.ms >= 0);
});

test("GET and HEAD never send a body; an empty body is not sent either", async () => {
  const g = await req("/echo", { body: "ignored" });
  assert.ok(g.ok && JSON.parse(g.body).body === "");
  const head = await req("/echo", { method: "HEAD", body: "ignored" });
  assert.ok(head.ok && head.body === "" && head.status === 200);
  const post = await req("/echo", { method: "POST", body: "" });
  assert.ok(post.ok && JSON.parse(post.body).body === "");
});

test("redirects are followed, error statuses are results, and an empty answer has an empty body", async () => {
  const red = await req("/redirect");
  assert.ok(red.ok && JSON.parse(red.body).method === "GET");
  const tea = await req("/teapot");
  assert.ok(tea.ok && tea.status === 418 && tea.body === "short and stout");
  assert.equal(tea.statusText, "I am a teapot");
  const none = await req("/empty");
  assert.ok(none.ok && none.status === 204 && none.body === "" && none.size === 0);
});

test("a response over 2 MB is cut and says so; size reports Content-Length when it is known", async () => {
  const big = await req("/big");
  assert.ok(big.ok);
  assert.equal(big.size, 3 * MB);
  assert.ok(big.body.endsWith("\n… (response truncated to 2 MB)"));
  assert.equal(big.body.length, 2 * MB + "\n… (response truncated to 2 MB)".length);
  const chunked = await req("/big-chunked");
  assert.ok(chunked.ok);
  assert.ok(chunked.size > 2 * MB, "without Content-Length: what was read");
  assert.ok(chunked.body.endsWith("truncated to 2 MB)"));
});

test("send refuses bad URLs and reports network failures as results with the cause", async () => {
  await assert.rejects(send({ method: "GET", url: "ftp://example.com", headers: [] }), (e: Error & { status?: number }) => e.status === 400 && /Only http/.test(e.message));
  await assert.rejects(send({ method: "GET", url: "no url", headers: [] }), /Invalid URL: no url/);
  const closed = createServer();
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  const port = (closed.address() as AddressInfo).port;
  await new Promise((r) => closed.close(r));
  const r = await send({ method: "GET", url: `http://127.0.0.1:${port}/`, headers: [] });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /fetch failed \(ECONNREFUSED\)/);
});

const mounted = await mountModule(register);
const storeFile = join(mounted.ctx.dataDir, "store.json");

test("the store starts empty, validates what it saves and persists it", async () => {
  assert.deepEqual((await mounted.get("/http")).body, { collections: [], envs: [], activeEnv: null });
  assert.equal((await mounted.call("PUT", "/http", { collections: [] })).status, 400);
  assert.equal((await mounted.call("PUT", "/http", { envs: [], collections: "x" })).status, 400);
  assert.equal(existsSync(storeFile), false, "nothing written for invalid input");
  const store = { collections: [{ id: "c", name: "API", requests: [] }], envs: [{ id: "e", name: "dev", vars: [{ k: "host", v: "x", on: true }] }], activeEnv: "e" };
  assert.deepEqual((await mounted.call("PUT", "/http", store)).body, { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(storeFile, "utf8")), store);
  assert.deepEqual((await mounted.get("/http")).body, store);
});

test("writeStore and readStore work on the folder given to initStore", () => {
  initStore(mounted.ctx.dataDir);
  assert.throws(() => writeStore(null as never), /Invalid format/);
  writeStore({ collections: [], envs: [], activeEnv: null });
  assert.equal(readStore().activeEnv, null);
  writeFileSync(storeFile, "{ not json");
  assert.deepEqual(readStore(), { collections: [], envs: [], activeEnv: null }, "a damaged file reads as empty");
});

test("POST /http/send goes through the sender", async () => {
  const ok = await mounted.call("POST", "/http/send", { method: "POST", url: `${origin}/echo`, headers: [], body: "hi" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(JSON.parse(ok.body.body).body, "hi");
  assert.equal((await mounted.call("POST", "/http/send", { method: "GET", url: "gopher://x", headers: [] })).status, 400);
});
