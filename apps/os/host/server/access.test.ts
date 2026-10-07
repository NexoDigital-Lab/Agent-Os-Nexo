import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessFile, cookieName, issueAccess } from "./access.ts";
import { guardRequest, sameOrigin } from "./http.ts";

const state = mkdtempSync(join(tmpdir(), "access-"));
let server: Server;
let port = 0;
after(() => (server?.close(), rmSync(state, { recursive: true, force: true })));

async function start() {
  server = createServer((req, res) => {
    const guard = guardRequest(port);
    guard(req, res, () => res.end(JSON.stringify({ reached: req.url })));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.end();
  });

test("the API needs this run's token; the health check and the page do not", async () => {
  await start();
  const token = issueAccess(state, port);
  assert.equal(readFileSync(accessFile(state, port), "utf8").trim(), token);
  if (process.platform !== "win32") {
    // Windows does not enforce Unix file modes; chmod is a no-op there
    assert.equal(statSync(accessFile(state, port)).mode & 0o777, 0o600);
  }

  assert.equal((await get("/api/tabs")).status, 401);
  assert.match((await get("/api/tabs")).body, /"access":true/);
  assert.equal((await get("/api/os/info")).status, 200, "health check stays open");
  assert.equal((await get("/")).status, 200, "the page itself loads (and explains how to get in)");

  const link = await get(`/?token=${token}`);
  assert.equal(link.status, 302);
  assert.equal(link.headers.location, "/");
  const cookie = String((link.headers["set-cookie"] as string[])[0]).split(";")[0]!;
  assert.match(String(link.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);
  assert.equal(cookie, `${cookieName(port)}=${token}`);

  assert.equal((await get("/api/tabs", { cookie })).status, 200);
  assert.equal((await get("/api/tabs", { "x-nexo-token": token })).status, 200, "scripts the user runs can send a header");
  assert.equal((await get("/api/tabs", { cookie: `${cookieName(port)}=nope` })).status, 401);
  assert.equal((await get("/?token=stale")).status, 403, "an old link is refused, not silently ignored");
});

test("WebSocket upgrades need the token too", () => {
  const base = { origin: `http://localhost:${port}`, host: `localhost:${port}` };
  const token = readFileSync(accessFile(state, port), "utf8").trim();
  assert.equal(sameOrigin({ headers: base } as never, port), false);
  assert.equal(sameOrigin({ headers: { ...base, cookie: `${cookieName(port)}=${token}` } } as never, port), true);
});
