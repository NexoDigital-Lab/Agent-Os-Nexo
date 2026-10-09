// The frameworks routes: validation before the CLI runs, how values reach `nexo framework` (after `--`), the hooks
// approval handshake, error statuses — and, with the CLI in this checkout, a real add/enable/default round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempDir, tempEnv } from "../../../host/test/harness.ts";
import { httpError } from "../../../host/server/http.ts";
import { frameworksVersion } from "../../../host/server/frameworks.ts";
import register from "../server/index.ts";
import { deps } from "../server/frameworks.ts";

const env = tempEnv({ tools: { claude: true } });
const entry = (over: Record<string, unknown> = {}) => ({
  name: "corp", kind: "method", source: "npm:corp@1.0.0", version: "1.0.0", license: "MIT", managed: "nexo", enabled: true, hooksApproved: false,
  hookCommands: ["node guard.js"], contributions: { skills: ["skills/a"], agents: [], commands: [], mcpServers: [], instructions: ["CLAUDE.md"], hooks: 1 }, isDefault: false, ...over,
});
let list: unknown = { default: "nexo", frameworks: [entry()], broken: [] };
const calls: string[][] = [];
let fail: Error | null = null;
const realNexo = deps.nexo;
deps.nexo = async (_env, args) => {
  calls.push(args);
  if (fail && args[1] !== "list") throw fail;
  return typeof list === "string" ? list : JSON.stringify(list);
};
const { call, get } = await mountModule(register, { env });
const last = () => calls.filter((c) => c[1] !== "list").at(-1);

test("list asks the CLI for JSON and returns the validated frameworks", async () => {
  const r = await get("/frameworks");
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1), ["framework", "list", "--json", "--"]);
  assert.equal(r.body.default, "nexo");
  assert.equal(r.body.frameworks[0].name, "corp");
  assert.deepEqual(r.body.frameworks[0].hookCommands, ["node guard.js"]);
});

test("enable, disable and default go to the CLI with the name after --; changes bump the version", async () => {
  const v = frameworksVersion();
  assert.equal((await call("POST", "/frameworks/corp/enabled", { enabled: true })).status, 200);
  assert.deepEqual(last(), ["framework", "enable", "--", "corp"]);
  await call("POST", "/frameworks/corp/enabled", { enabled: false });
  assert.deepEqual(last(), ["framework", "disable", "--", "corp"]);
  await call("POST", "/frameworks/default", { name: "corp" });
  assert.deepEqual(last(), ["framework", "default", "--", "corp"]);
  await call("POST", "/frameworks/default", { name: "nexo" });
  assert.deepEqual(last(), ["framework", "default", "--", "nexo"]);
  assert.equal(frameworksVersion(), v + 4);
});

test("approving hooks needs the commands the user saw; a mismatch is a 409 and nothing runs", async () => {
  const before = calls.length;
  assert.equal((await call("POST", "/frameworks/corp/hooks", { approved: true })).status, 400);
  assert.equal((await call("POST", "/frameworks/corp/hooks", { approved: true, seen: [1] })).status, 400);
  const stale = await call("POST", "/frameworks/corp/hooks", { approved: true, seen: ["node other.js"] });
  assert.equal(stale.status, 409);
  assert.ok(calls.slice(before).every((c) => c[1] === "list"), "only reads happened");
  assert.equal((await call("POST", "/frameworks/ghost/hooks", { approved: true, seen: [] })).status, 404);
  const ok = await call("POST", "/frameworks/corp/hooks", { approved: true, seen: ["node guard.js"] });
  assert.equal(ok.status, 200);
  assert.deepEqual(last(), ["framework", "enable", "--hooks", "--", "corp"]);
  // withdrawing needs no proof
  await call("POST", "/frameworks/corp/hooks", { approved: false });
  assert.deepEqual(last(), ["framework", "disable", "--hooks", "--", "corp"]);
  list = { default: "nexo", frameworks: [entry({ hookCommands: [] })], broken: [] };
  assert.equal((await call("POST", "/frameworks/corp/hooks", { approved: true, seen: [] })).status, 400);
  list = { default: "nexo", frameworks: [entry()], broken: [] };
});

test("add validates the source before the CLI runs and passes it after --", async () => {
  const n = calls.length;
  for (const body of [{}, { source: 5 }, { source: "npm:corp" }, { source: "npm:corp@latest" }, { source: "npm:corp@^1.0.0" }, { source: "github:a/b" }, { source: "path:relative/dir" }, { source: "path:/a\nb" }, { source: "x".repeat(501) }, { source: "npm:corp@1.0.0", name: "Bad Name" }, { source: "npm:corp@1.0.0", name: 7 }]) {
    assert.equal((await call("POST", "/frameworks", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, n);
  await call("POST", "/frameworks", { source: " npm:@corp/agents@1.4.0 " });
  assert.deepEqual(last(), ["framework", "add", "--", "npm:@corp/agents@1.4.0"]);
  await call("POST", "/frameworks", { source: "path:/opt/fw", name: "mine" });
  assert.deepEqual(last(), ["framework", "add", "--name", "mine", "--", "path:/opt/fw"]);
  await call("POST", "/frameworks", { source: "path:C:\\fw" });
  await call("POST", "/frameworks", { source: "path:~/fw", name: "" });
  assert.deepEqual(last(), ["framework", "add", "--", "path:~/fw"]);
});

test("bad names and bodies are a 400 before the CLI runs", async () => {
  const n = calls.length;
  assert.equal((await call("POST", "/frameworks/Bad%20Name/enabled", { enabled: true })).status, 400);
  assert.equal((await call("POST", "/frameworks/corp/enabled", { enabled: "yes" })).status, 400);
  assert.equal((await call("POST", "/frameworks/corp/enabled", {})).status, 400);
  assert.equal((await call("POST", "/frameworks/default", { name: "../x" })).status, 400);
  assert.equal((await call("POST", "/frameworks/default", {})).status, 400);
  assert.equal((await call("POST", "/frameworks/corp/hooks", { approved: "y" })).status, 400);
  assert.equal((await call("DELETE", "/frameworks/UP")).status, 400);
  assert.equal(calls.length, n);
  await call("DELETE", "/frameworks/corp");
  assert.deepEqual(last(), ["framework", "remove", "--", "corp"]);
});

test("the CLI's errors keep their message with the right status", async () => {
  const boom = (msg: string) => (fail = httpError(500, `nexo framework failed: nexo: ${msg}`));
  boom('No framework "corp". See `nexo framework list`.');
  assert.equal((await call("POST", "/frameworks/corp/enabled", { enabled: true })).status, 404);
  boom('Enable "corp" first: `nexo framework enable corp`.');
  assert.equal((await call("POST", "/frameworks/default", { name: "corp" })).status, 400);
  boom('Framework "corp" already exists. Remove it first, or pass --name.');
  assert.equal((await call("POST", "/frameworks", { source: "npm:corp@1.0.0" })).status, 409);
  boom('Unknown command "framework". Run `nexo --help`.');
  assert.equal((await call("POST", "/frameworks/corp/enabled", { enabled: true })).status, 501);
  boom("disk on fire");
  assert.equal((await call("DELETE", "/frameworks/corp")).status, 500);
  fail = null;
});

test("a CLI that cannot list frameworks as JSON is a 502 with the way out", async () => {
  list = "not json";
  const a = await get("/frameworks");
  assert.deepEqual([a.status, /not JSON/.test(a.body.error)], [502, true]);
  list = "{}";
  const b = await get("/frameworks");
  assert.deepEqual([b.status, /update it/.test(b.body.error)], [502, true]);
  list = { default: "", frameworks: [entry({ name: "../x" }), { name: "ok", kind: "tool" }, 5], broken: ["b", 2] };
  const c = (await get("/frameworks")).body;
  assert.equal(c.default, "nexo");
  assert.deepEqual(c.frameworks.map((f: any) => [f.name, f.kind, f.enabled, f.managed]), [["ok", "tool", false, "external"]]);
  assert.deepEqual(c.broken, ["b"]);
  list = { default: "nexo", frameworks: [entry()], broken: [] };
});

const CLI = join(import.meta.dirname, "..", "..", "..", "..", "..", "packages", "cli", "src", "bin.ts");
test("a real round trip through the nexo CLI: add (off) → enable → default, with a path: framework", { skip: !existsSync(CLI) && "no CLI in this checkout" }, async () => {
  deps.nexo = realNexo;
  const before = process.env.NEXO_CLI;
  process.env.NEXO_CLI = CLI;
  try {
    const ext = tempDir();
    writeFileSync(join(ext, "CLAUDE.md"), "Be careful.");
    mkdirSync(join(ext, "skills", "a"), { recursive: true });
    writeFileSync(join(ext, "skills", "a", "SKILL.md"), "---\nname: a\ndescription: d\n---\n");
    const added = await call("POST", "/frameworks", { source: `path:${ext}`, name: "mine" });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.deepEqual([added.body.frameworks[0].name, added.body.frameworks[0].kind, added.body.frameworks[0].enabled], ["mine", "method", false]);
    assert.equal((await call("POST", "/frameworks/default", { name: "mine" })).status, 400, "not enabled yet");
    assert.equal((await call("POST", "/frameworks/mine/enabled", { enabled: true })).body.frameworks[0].enabled, true);
    const def = await call("POST", "/frameworks/default", { name: "mine" });
    assert.equal(def.body.default, "mine");
    assert.equal(def.body.frameworks[0].isDefault, true);
    assert.equal((await call("DELETE", "/frameworks/mine")).body.default, "nexo");
  } finally {
    if (before === undefined) delete process.env.NEXO_CLI;
    else process.env.NEXO_CLI = before;
  }
});
