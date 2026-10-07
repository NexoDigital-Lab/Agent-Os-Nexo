// Restart: the plan (what starts, where its output and pid go) and the detached helper that carries it out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, tempEnv } from "../test/harness.ts";
import { takeInheritedToken, issueAccess } from "./access.ts";
import { relaunchPlan, startRelaunch } from "./restart.ts";

const TOKEN = "ab".repeat(24);

function build(env: ReturnType<typeof tempEnv>, v: string) {
  const dir = join(env.os, "versions", v, "host", "server");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), "");
  return join(env.os, "versions", v);
}

test("a build restarts on the build to load (pin first, else the newest), on the same port, with the token", () => {
  const env = tempEnv();
  build(env, "1.0.0");
  const newest = build(env, "1.0.1");
  const plan = relaunchPlan({ appDir: "/app", env, port: 4780, dev: false, token: TOKEN, pid: 42, vars: { PATH: "/bin" } });
  assert.deepEqual(plan.args, [join(newest, "host", "server", "main.ts"), "--port", "4780"]);
  assert.equal(plan.cwd, newest);
  assert.equal(plan.waitFor, 42);
  assert.equal(plan.token, TOKEN);
  assert.equal(plan.env.NEXO_ACCESS_TOKEN_STDIN, "1");
  assert.ok(!Object.values(plan.env).includes(TOKEN), "the token is never in the new server's environment");
  assert.equal(plan.env.NEXO_ROOT, env.root);
  assert.equal(plan.env.PATH, "/bin");
  assert.equal(plan.log, join(env.state, "restart.log"), "no launcher log: the environment's restart.log");
  assert.equal(plan.pidFile, null);
  writeFileSync(join(env.os, "current"), "1.0.0\n");
  assert.equal(relaunchPlan({ appDir: "/app", env, port: 4780, dev: false, token: TOKEN, vars: {} }).cwd, join(env.os, "versions", "1.0.0"));
});

test("the preview restarts on its source with --dev; the launcher's log and pid file are kept", () => {
  const env = tempEnv();
  build(env, "1.0.0");
  const plan = relaunchPlan({ appDir: "/src", env, port: 4781, dev: true, token: TOKEN, vars: { NEXO_LOG_FILE: "/l/app.log", NEXO_PID_FILE: "/l/app.pid" } });
  assert.deepEqual(plan.args, [join("/src", "host", "server", "main.ts"), "--port", "4781", "--dev"]);
  assert.equal(plan.log, "/l/app.log");
  assert.equal(plan.pidFile, "/l/app.pid");
});

test("a build that is gone falls back to the running folder", () => {
  const env = tempEnv();
  writeFileSync(join(env.os, "current"), "9.9.9\n");
  assert.equal(relaunchPlan({ appDir: "/app", env, port: 1, dev: false, token: TOKEN, vars: {} }).cwd, "/app");
});

test("the inherited token comes from stdin only when flagged, once, and only a well-formed one is reused", () => {
  const vars: NodeJS.ProcessEnv = { NEXO_ACCESS_TOKEN_STDIN: "1" };
  assert.equal(takeInheritedToken(vars, () => `${TOKEN}\n`), TOKEN);
  assert.equal(vars.NEXO_ACCESS_TOKEN_STDIN, undefined, "agents spawned later do not inherit the flag");
  assert.equal(takeInheritedToken({}, () => assert.fail("stdin is not read without the flag")), undefined);
  assert.equal(takeInheritedToken({ NEXO_ACCESS_TOKEN_STDIN: "1" }, () => "x; rm -rf"), undefined);
  assert.equal(takeInheritedToken({ NEXO_ACCESS_TOKEN_STDIN: "1" }, () => { throw new Error("EAGAIN"); }), undefined);
  const state = tempDir();
  assert.equal(issueAccess(state, 1, TOKEN), TOKEN);
  assert.notEqual(issueAccess(state, 2, "short"), "short");
});

test("the helper waits for the old process, then starts the new one with the token and records its pid", async () => {
  const dir = tempDir();
  const out = join(dir, "started.json");
  const old = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600)"], { stdio: "ignore" });
  const t0 = Date.now();
  const script = `const fs = require("fs"); fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ token: fs.readFileSync(0, "utf8").trim(), envToken: Object.values(process.env).includes(${JSON.stringify(TOKEN)}), at: Date.now(), args: process.argv.slice(1) }))`;
  startRelaunch({
    waitFor: old.pid!, command: process.execPath, args: ["-e", script, "x"], cwd: dir,
    env: { ...process.env, NEXO_ACCESS_TOKEN_STDIN: "1" } as Record<string, string>, token: TOKEN, log: join(dir, "logs", "restart.log"), pidFile: join(dir, "app.pid"),
  });
  for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
  const started = JSON.parse(readFileSync(out, "utf8")) as { token: string; envToken: boolean; at: number; args: string[] };
  assert.equal(started.token, TOKEN, "the token arrives on stdin");
  assert.equal(started.envToken, false, "and not in the environment");
  assert.deepEqual(started.args, ["x"]);
  assert.ok(started.at - t0 >= 500, "it waited for the old process to end");
  assert.match(readFileSync(join(dir, "app.pid"), "utf8"), /^\d+$/);
  assert.ok(existsSync(join(dir, "logs", "restart.log")), "the log folder is created");
});
