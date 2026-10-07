import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as providers from "../../../host/server/providers.ts";
import { ask, getActiveProviderId, pathAllowed, setActiveProviderId, structured, toolPaths, type QueryFn } from "../server/claude.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "conf-"));
const cwd = path.join(tmp, "repo");
const extra = path.join(tmp, "biz");
const outside = path.join(tmp, "outside");
for (const d of [cwd, extra, outside]) mkdirSync(d);
symlinkSync(outside, path.join(cwd, "link"));

test("pathAllowed: inside cwd (relative and absolute) and extra dirs", () => {
  assert.ok(pathAllowed("src/a.ts", cwd));
  assert.ok(pathAllowed(".", cwd));
  assert.ok(pathAllowed(path.join(cwd, "x/y.ts"), cwd));
  assert.ok(pathAllowed(path.join(extra, "ctx.md"), cwd, [extra]));
});

test("pathAllowed: denies '..' escapes, siblings with the same prefix, absolute outside, ~ and symlinks", () => {
  assert.equal(pathAllowed("../outside/x", cwd), false);
  assert.equal(pathAllowed("src/../../outside", cwd), false);
  assert.equal(pathAllowed(cwd + "-evil/x", cwd), false);
  assert.equal(pathAllowed("/etc/passwd", cwd), false);
  assert.equal(pathAllowed("~/.ssh/id_rsa", cwd), false);
  assert.equal(pathAllowed("link/secret", cwd), false);
  assert.equal(pathAllowed(path.join(extra, "x"), cwd), false); // extra dir not granted
});

test("toolPaths: collects file_path/path and absolute globs, flags '..' in globs", () => {
  assert.deepEqual(toolPaths("Read", { file_path: "a.ts" }).paths, ["a.ts"]);
  assert.deepEqual(toolPaths("Grep", { pattern: "../../x", path: "src" }), { paths: ["src"], bad: false }); // regex, not a path
  assert.equal(toolPaths("Glob", { pattern: "../**/*.ts" }).bad, true);
  assert.equal(toolPaths("Grep", { pattern: "x", glob: "../*" }).bad, true);
  assert.deepEqual(toolPaths("Glob", { pattern: "/etc/*.conf" }).paths, ["/etc/"]);
  assert.equal(pathAllowed("/etc/", cwd), false);
});

// ---- provider routing (T2) -------------------------------------------------------------------
const fake = (msgs: unknown[]): QueryFn =>
  ((args: unknown) => {
    void args;
    return (async function* () {
      for (const m of msgs) yield m;
    })();
  }) as unknown as QueryFn;

const realRun = providers.providerExec.run;
const realFind = providers.providerExec.find;

test("the active provider defaults to claude", () => {
  assert.equal(getActiveProviderId(), "claude");
});

test("ask routes to the headless provider when the active id is a CLI provider", async () => {
  providers.providerExec.find = (n: string) => (n === "opencode" ? "/usr/bin/opencode" : null);
  let argv: string[] = [];
  let runOpts: any = null;
  providers.providerExec.run = ((_c: string, args: string[], opts: any) => {
    argv = args;
    runOpts = opts;
    return Promise.resolve({ stdout: "  provider says hi\n", stderr: "" });
  }) as unknown as typeof providers.providerExec.run;
  setActiveProviderId("opencode");
  try {
    // The SDK stream is ignored: the CLI provider must answer instead (cost unknown → 0).
    const r = await ask("the question", "system prompt", cwd, fake([{ type: "result", subtype: "success", total_cost_usd: 9, result: "claude answer" }]));
    assert.deepEqual(r, { text: "provider says hi", cost: 0 });
    assert.deepEqual(argv, ["run", "the question"]);
    assert.equal(runOpts.cwd, cwd);
  } finally {
    setActiveProviderId("claude");
    providers.providerExec.run = realRun;
    providers.providerExec.find = realFind;
  }
});

test("structured throws 502 when the active provider is not claude (no silent fallback)", async () => {
  setActiveProviderId("codex");
  try {
    await assert.rejects(
      structured("p", cwd, {}, [], fake([{ type: "result", subtype: "success", total_cost_usd: 1, structured_output: { a: 1 } }])),
      (e: any) => e.status === 502 && /need Claude/.test(e.message),
    );
  } finally {
    setActiveProviderId("claude");
  }
});

test("ask keeps the SDK path when the active provider is claude or null", async () => {
  const seen: any[] = [];
  const sdk = ((args: unknown) => {
    seen.push(args);
    return (async function* () {
      yield { type: "result", subtype: "success", total_cost_usd: 0.5, result: "  sdk answer \n" };
    })();
  }) as unknown as QueryFn;
  const r = await ask("q", "be brief", cwd, sdk);
  assert.deepEqual(r, { text: "sdk answer", cost: 0.5 });
  assert.equal(seen[0].options.systemPrompt, "be brief");
  setActiveProviderId(null); // null counts as claude
  try {
    const r2 = await ask("q2", "s", cwd, sdk);
    assert.equal(r2.text, "sdk answer");
  } finally {
    setActiveProviderId("claude");
  }
});
