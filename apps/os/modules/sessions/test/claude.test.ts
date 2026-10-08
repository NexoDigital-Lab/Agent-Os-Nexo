import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as providers from "../../../host/server/providers.ts";
import { ask, getActiveProviderId, pathAllowed, structured, toolPaths, useProvidersFile, type QueryFn } from "../server/claude.ts";

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

const realFind = providers.providerExec.find;

test("the default chat provider is claude until a providers.json says otherwise, read on each call", () => {
  assert.equal(getActiveProviderId(), "claude");
  let value: "opencode" | "codex" = "opencode";
  useProvidersFile("/env/library/providers.json", () => value);
  try {
    assert.equal(getActiveProviderId(), "opencode");
    value = "codex"; // changed in the Providers view: no restart needed
    assert.equal(getActiveProviderId(), "codex");
  } finally {
    useProvidersFile("", () => "claude");
  }
});

test("one-shot helpers stay on the bundled SDK whatever the default chat provider (they must stay read-only)", async () => {
  providers.providerExec.find = () => assert.fail("no CLI is spawned for a one-shot");
  useProvidersFile("/env/library/providers.json", () => "opencode");
  try {
    const r = await ask("the question", "system prompt", cwd, fake([{ type: "result", subtype: "success", total_cost_usd: 0.5, result: "  sdk answer \n" }]));
    assert.deepEqual(r, { text: "sdk answer", cost: 0.5 });
    const s = await structured<{ a: number }>("p", cwd, {}, [], fake([{ type: "result", subtype: "success", total_cost_usd: 1, structured_output: { a: 1 } }]));
    assert.deepEqual(s.out, { a: 1 });
  } finally {
    useProvidersFile("", () => "claude");
    providers.providerExec.find = realFind;
  }
});
