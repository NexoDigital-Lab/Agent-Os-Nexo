// The whole host on a free port, with two small modules: the guard, the host routes, mounting, and the web UI.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tempDir, tempEnv } from "../test/harness.ts";
import { createAgentOs } from "./app.ts";
import { readVersion } from "./routes.ts";

/** An agent-os folder: a working module, a module whose server throws, a broken manifest, and a built UI. */
function appDir(withWeb = true): string {
  const dir = tempDir("agent-os-app-");
  const mod = (id: string, manifest: Record<string, unknown>, server?: string) => {
    mkdirSync(join(dir, "modules", id, "server"), { recursive: true });
    writeFileSync(join(dir, "modules", id, "module.json"), JSON.stringify({ name: id, version: "1.2.3", description: id, ...manifest }));
    if (server) writeFileSync(join(dir, "modules", id, "server", "index.ts"), server);
  };
  mod("hello", { core: true, entry: { server: "server/index.ts" }, nav: { label: "Hello" } }, `export default (ctx) => { ctx.api.get("/hello", (_req, res) => res.json({ id: ctx.id, data: ctx.dataDir })); ctx.api.get("/hello/boom", () => { throw new Error("kaboom"); }); };`);
  mod("broken", { dependsOn: ["hello"], entry: { server: "server/index.ts" } }, `export default () => { throw new Error("cannot start"); };`);
  mkdirSync(join(dir, "modules", "bad"));
  writeFileSync(join(dir, "modules", "bad", "module.json"), "{}");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
  if (withWeb) {
    mkdirSync(join(dir, "dist", "web"), { recursive: true });
    writeFileSync(join(dir, "dist", "web", "index.html"), "<!doctype html><title>agent-os</title>");
    writeFileSync(join(dir, "dist", "web", "app.js"), "console.log(1)");
  }
  return dir;
}

const env = tempEnv();
writeFileSync(join(env.library, "profile.json"), JSON.stringify({ language: "es", identity: { name: "Ana" } }));
const warnings: string[] = [];
const dir = appDir();
// The guard checks the Host against the port, so the port is chosen before the app is built.
const port = await new Promise<number>((r) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const p = (probe.address() as AddressInfo).port;
    probe.close(() => r(p));
  });
});
const { server, token, failed } = await createAgentOs({ appDir: dir, env, port, dev: false, version: readVersion(dir), warn: (m) => warnings.push(m) });
await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
after(() => (server.closeAllConnections(), server.close()));

/** A request the way a script the user runs makes it: this run's token in X-Nexo-Token. */
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-nexo-token": token }) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // HTML or plain text
  }
  return { status: res.status, body: parsed, headers: res.headers };
};

test("modules mount in order; a failing one is reported, a bad manifest is a warning", () => {
  assert.match(failed.get("broken")!, /cannot start/);
  assert.ok(warnings.some((w) => w.startsWith("[modules] ") && w.includes("bad")), warnings.join("\n"));
  assert.equal(readFileSync(join(env.state, `token-${port}`), "utf8").trim(), token);
});

test("the guard runs first: no token, no API; a foreign origin cannot change anything", async () => {
  const anonymous = await call("GET", "/api/os/modules", undefined, {});
  assert.deepEqual([anonymous.status, anonymous.body.access], [401, true]);
  assert.equal((await call("GET", "/api/os/info", undefined, {})).status, 200, "the health check is open");
  const foreign = await call("PUT", "/api/os/prefs", { theme: "x" }, { "x-nexo-token": token, origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
});

test("the host routes: info, modules, prefs", async () => {
  const info = (await call("GET", "/api/os/info")).body;
  assert.deepEqual({ ...info, environment: undefined }, { version: "1.0.0", dev: false, newer: null, environment: undefined, language: "es", user: "Ana" });
  const modules = (await call("GET", "/api/os/modules")).body as Array<{ id: string; active: boolean; error: string | null; enabled: boolean }>;
  assert.deepEqual(modules.map((m) => [m.id, m.active, m.error !== null]), [["hello", true, false], ["broken", false, true]]);

  assert.equal((await call("PUT", "/api/os/modules", { id: "broken" })).status, 400);
  assert.equal((await call("PUT", "/api/os/modules", { id: "hello", enabled: false })).status, 409, "a core module cannot be turned off");
  assert.deepEqual((await call("PUT", "/api/os/modules", { id: "broken", enabled: false })).body, { ok: true, restart: true });
  assert.equal((await call("GET", "/api/os/modules")).body.find((m: any) => m.id === "broken").enabled, false);

  assert.deepEqual((await call("GET", "/api/os/prefs")).body, {});
  assert.deepEqual((await call("PUT", "/api/os/prefs", { theme: "dark" })).body, { theme: "dark" });
  assert.deepEqual((await call("PUT", "/api/os/prefs", { language: "en" })).body, { theme: "dark", language: "en" });
  assert.equal((await call("GET", "/api/os/info")).body.language, "en", "the language chosen in Settings wins");
  assert.equal((await call("PUT", "/api/os/prefs", [1])).status, 400);
});

test("a module's routes, its errors, and unknown API routes", async () => {
  assert.deepEqual((await call("GET", "/api/hello")).body, { id: "hello", data: join(env.data, "hello") });
  const boom = await call("GET", "/api/hello/boom");
  assert.deepEqual([boom.status, boom.body], [500, { error: "kaboom" }]);
  const unknown = await call("GET", "/api/nope");
  assert.deepEqual([unknown.status, unknown.body], [404, { error: "Unknown API route" }]);
});

test("the built UI: static files, and index.html for every other page", async () => {
  assert.equal((await call("GET", "/app.js")).body, "console.log(1)");
  assert.match((await call("GET", "/settings/themes")).body, /<title>agent-os<\/title>/);
});

test("a build without its web UI refuses to start", async () => {
  await assert.rejects(
    createAgentOs({ appDir: appDir(false), env: tempEnv(), port: 0, dev: false, version: "1.0.0", warn: () => {} }),
    /This build has no web UI/,
  );
});

test("readVersion: build.json's personal version, else the package's", () => {
  const d = tempDir();
  writeFileSync(join(d, "package.json"), JSON.stringify({ version: "1.0.0" }));
  assert.equal(readVersion(d), "1.0.0");
  writeFileSync(join(d, "build.json"), JSON.stringify({ version: "1.0.7" }));
  assert.equal(readVersion(d), "1.0.7");
});
