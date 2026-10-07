// The dictionary routes: validation, how they call `nexo dict` (options before `--`, the term after it), how the CLI's
// errors become statuses, and — when the CLI is in this checkout — a real round-trip through library/dictionary/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { httpError } from "../../../host/server/http.ts";
import register from "../server/index.ts";
import { deps } from "../server/dictionary.ts";

const env = tempEnv();
const calls: string[][] = [];
let reply: (args: string[]) => string = () => "";
const realNexo = deps.nexo;
deps.nexo = async (_env, args) => {
  calls.push(args);
  return reply(args);
};
const { call, get } = await mountModule(register, { env });

const TERM = { term: "Cliente activo", aliases: ["activo"], summary: "Compró en 90 días", owner: "user", updated: "2026-10-07", path: "dictionary/cliente-activo.md", body: "Detalle." };

test("list and show call the CLI with --json; the term goes after --", async () => {
  reply = (a) => (a[1] === "list" ? JSON.stringify([TERM]) : JSON.stringify(TERM));
  assert.deepEqual((await get("/dictionary")).body, [TERM]);
  assert.deepEqual((await get("/dictionary/--rm")).body, TERM);
  assert.deepEqual(calls.at(-1), ["dict", "show", "--json", "--", "--rm"], "a term that looks like an option stays a term");
});

test("create and edit pass only the given fields; edit renames with --from", async () => {
  reply = () => JSON.stringify(TERM);
  calls.length = 0;
  await call("POST", "/dictionary", { term: " Cliente activo ", summary: "Compró en 90 días", aliases: ["activo", "a,b"] });
  assert.deepEqual(calls[0], ["dict", "add", "--summary", "Compró en 90 días", "--alias", "activo,a b", "--", "Cliente activo"]);
  calls.length = 0;
  await call("PUT", `/dictionary/${encodeURIComponent("Clinte")}`, { term: "Cliente", body: "" });
  assert.deepEqual(calls[0], ["dict", "add", "--body", "", "--from", "Clinte", "--", "Cliente"]);
});

test("bad input is a 400 before the CLI runs", async () => {
  calls.length = 0;
  for (const body of [{}, { term: "" }, { term: "!!!" }, { term: 5 }, { term: "x".repeat(81) }, { term: "x", summary: "y".repeat(241) }, { term: "x", aliases: "a" }, { term: "x", aliases: [1] }]) {
    assert.equal((await call("POST", "/dictionary", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test("the CLI's errors keep their message and get the right status", async () => {
  const fail = (msg: string) => () => {
    throw httpError(500, `nexo dict failed: nexo: ${msg}`);
  };
  reply = fail('No term "x" in library/dictionary/.');
  assert.deepEqual([(await get("/dictionary/x")).status, (await get("/dictionary/x")).body.error], [404, 'No term "x" in library/dictionary/.']);
  reply = fail('"Nuevo" is new: give it a summary (one line saying what it means).');
  assert.equal((await call("POST", "/dictionary", { term: "Nuevo" })).status, 400);
  reply = fail('"otro" is already the term "Otro".');
  assert.equal((await call("PUT", "/dictionary/a", { term: "otro" })).status, 409);
  reply = fail('Unknown command "dict". Run `nexo --help`.');
  const old = await get("/dictionary");
  assert.equal(old.status, 501);
  assert.match(old.body.error, /update it/);
});

// The real CLI, when this module runs inside the monorepo (a user's os/source has no packages/cli: skipped there).
const CLI = join(import.meta.dirname, "..", "..", "..", "..", "..", "packages", "cli", "src", "bin.ts");
test("round-trip through the real nexo CLI into library/dictionary/ and index.json", { skip: !existsSync(CLI) && "no CLI in this checkout" }, async () => {
  deps.nexo = realNexo;
  const before = process.env.NEXO_CLI;
  process.env.NEXO_CLI = CLI;
  try {
    const created = await call("POST", "/dictionary", { term: "Cliente activo", summary: "Compró en 90 días", aliases: ["activo"], body: "Se cuenta por cuenta." });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.term, "Cliente activo");
    assert.match(readFileSync(join(env.library, "dictionary", "cliente-activo.md"), "utf8"), /summary: Compró en 90 días/);
    const index = JSON.parse(readFileSync(join(env.library, "index.json"), "utf8"));
    assert.deepEqual(index.dictionary.map((d: { term: string }) => d.term), ["Cliente activo"]);
    const renamed = await call("PUT", `/dictionary/${encodeURIComponent("activo")}`, { term: "Cliente vigente" });
    assert.equal(renamed.body.term, "Cliente vigente");
    assert.equal(renamed.body.body, "Se cuenta por cuenta.", "the rest stays");
    assert.equal((await call("DELETE", `/dictionary/${encodeURIComponent("Cliente vigente")}`)).status, 200);
    assert.deepEqual((await get("/dictionary")).body, []);
  } finally {
    deps.nexo = async (_env, args) => (calls.push(args), reply(args));
    if (before === undefined) delete process.env.NEXO_CLI;
    else process.env.NEXO_CLI = before;
  }
});
