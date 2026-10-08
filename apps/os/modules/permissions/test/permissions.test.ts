// The permissions routes: scope (global or a known project), validation before the CLI runs, how values reach
// `nexo permissions` (after `--`), error statuses — and, with the CLI in this checkout, a real change on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { httpError } from "../../../host/server/http.ts";
import { initProjects } from "../../projects/server/projects.ts";
import register from "../server/index.ts";
import { deps } from "../server/permissions.ts";

const env = tempEnv({ tools: { claude: true } });
initProjects(env);
mkdirSync(join(env.projects, "shop", "code"), { recursive: true });
mkdirSync(join(env.projects, "shop", "context"), { recursive: true });
writeFileSync(join(env.projects, "shop", "AGENTS.md"), "# shop\n");

const calls: string[][] = [];
const VIEW = { effective: { default: "ask" }, global: { default: "ask" }, project: { commands: { deny: ["x"] } } };
let reply: (args: string[]) => string = () => JSON.stringify(VIEW);
const realNexo = deps.nexo;
deps.nexo = async (_env, args) => (calls.push(args), reply(args));
const { call, get } = await mountModule(register, { env });

test("global and project views; an unknown project is a 404", async () => {
  const global = (await get("/permissions")).body;
  assert.deepEqual([global.project, global.own, global.projects], [null, null, ["shop"]]);
  assert.deepEqual(calls.at(-1), ["permissions", "show", "--json", "--"]);
  const shop = (await get("/permissions?project=shop")).body;
  assert.deepEqual(shop.own, { commands: { deny: ["x"] } });
  assert.deepEqual(calls.at(-1), ["permissions", "show", "--json", "--project", "shop", "--"]);
  assert.equal((await get("/permissions?project=..%2Fetc")).status, 404);
});

test("a rule goes to the CLI with its values after --; null removes it", async () => {
  await call("POST", "/permissions/rule", { area: "commands", decision: "deny", pattern: " -rf* " });
  assert.deepEqual(calls.at(-2), ["permissions", "deny", "--", "commands", "-rf*"]);
  await call("POST", "/permissions/rule", { project: "shop", area: "files.edit", decision: null, pattern: "a/**" });
  assert.deepEqual(calls.at(-2), ["permissions", "remove", "--project", "shop", "--", "files.edit", "a/**"]);
  await call("POST", "/permissions/setting", { key: "connections.notion.write", decision: "ask" });
  assert.deepEqual(calls.at(-2), ["permissions", "set", "--", "connections.notion.write", "ask"]);
});

test("bad input is a 400 before the CLI runs", async () => {
  const n = calls.length;
  for (const body of [{}, { area: "files", decision: "allow", pattern: "x" }, { area: "commands", decision: "maybe", pattern: "x" }, { area: "commands", decision: "allow", pattern: "" }, { area: "commands", decision: "allow", pattern: "a\nb" }, { area: "commands", decision: "allow", pattern: "x".repeat(201) }]) {
    assert.equal((await call("POST", "/permissions/rule", body)).status, 400, JSON.stringify(body));
  }
  for (const body of [{ key: "files.read", decision: "allow" }, { key: "os.explode", decision: "allow" }, { key: "default", decision: "never" }, { key: "connections.a.b.read", decision: "allow" }]) {
    assert.equal((await call("POST", "/permissions/setting", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, n);
});

test("the CLI's errors keep their message with the right status", async () => {
  const fail = (msg: string) => () => { throw httpError(500, `nexo permissions failed: nexo: ${msg}`); };
  reply = fail('commands has no rule "z" in library/permissions.json.');
  assert.equal((await call("POST", "/permissions/rule", { area: "commands", decision: null, pattern: "z" })).status, 400);
  reply = fail('Unknown command "permissions". Run `nexo --help`.');
  const old = await get("/permissions");
  assert.deepEqual([old.status, /update it/.test(old.body.error)], [501, true]);
  reply = fail("disk on fire");
  assert.equal((await get("/permissions")).status, 500);
  reply = () => JSON.stringify(VIEW);
});

const CLI = join(import.meta.dirname, "..", "..", "..", "..", "..", "packages", "cli", "src", "bin.ts");
test("a real change through the nexo CLI lands in the file and in Claude's settings", { skip: !existsSync(CLI) && "no CLI in this checkout" }, async () => {
  deps.nexo = realNexo;
  const before = process.env.NEXO_CLI;
  process.env.NEXO_CLI = CLI;
  try {
    const out = await call("POST", "/permissions/rule", { area: "commands", decision: "allow", pattern: "make test*" });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.deepEqual(out.body.effective.commands.allow, ["make test*"]);
    assert.deepEqual(JSON.parse(readFileSync(join(env.library, "permissions.json"), "utf8")).commands.allow, ["make test*"]);
    assert.match(readFileSync(join(env.root, ".claude", "settings.json"), "utf8"), /Bash\(make test/);
    const project = await call("POST", "/permissions/setting", { project: "shop", key: "default", decision: "deny" });
    assert.equal(project.body.own.default, "deny");
    assert.equal(project.body.effective.default, "deny");
  } finally {
    deps.nexo = async (_env, args) => (calls.push(args), reply(args));
    if (before === undefined) delete process.env.NEXO_CLI;
    else process.env.NEXO_CLI = before;
  }
});
