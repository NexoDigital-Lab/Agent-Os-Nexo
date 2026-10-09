// The framework a tab works with, chosen like an AI provider: listed in /sessions/frameworks, validated in the send
// body, sticking per tab (default read live), passed to the Claude SDK as a plugin plus marked instructions, and
// prepended to the prompt of CLI providers. The nexo CLI, the SDK and the provider CLIs are all fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "../../../host/server/env.ts";
import { bumpFrameworks } from "../../../host/server/frameworks.ts";
import { mountModule, tempDir, tempEnv } from "../../../host/test/harness.ts";

const home = tempDir("fw-home-");
process.env.HOME = home;
process.env.USERPROFILE = home;
const env = tempEnv({ tools: { claude: true, opencode: true } });
mkdirSync(join(env.projects, "shop", "code"), { recursive: true });
writeFileSync(join(env.projects, "shop", "AGENTS.md"), "# shop");
execFileSync("git", ["init", "-q"], { cwd: join(env.projects, "shop", "code") });

const agent = await import("../server/agent.ts");
const { default: register } = await import("../server/index.ts");
const { initProjects } = await import("../../projects/server/projects.ts");
const fw = await import("../server/frameworks.ts");
const providers = await import("../../../host/server/providers.ts");
initProjects(env);
const m = await mountModule(register, { env, id: "sessions" });

// ---- the fakes ------------------------------------------------------------------------------------------------
const entry = (name: string, over: Record<string, unknown> = {}) => ({
  name, kind: "method", source: `npm:${name}@1.0.0`, version: "1.0.0", license: "MIT", managed: "nexo", enabled: true, hooksApproved: false,
  hookCommands: [], contributions: { skills: [], agents: [], commands: [], mcpServers: [], instructions: ["CLAUDE.md"], hooks: 0 }, isDefault: false, ...over,
});
let frameworks: any[] = [entry("corp"), entry("off", { enabled: false }), entry("dbtool", { kind: "tool" })];
let instructions = "Always write tests first.";
let pluginDir = join(env.root, ".state", "nexo", "plugins");
const cli: string[][] = [];
fw.deps.nexo = async (_env, args) => {
  cli.push(args);
  if (args[1] === "list") return JSON.stringify({ default: "nexo", frameworks, broken: [] });
  if (args[1] === "instructions") return `${instructions}\n`;
  if (args[1] === "plugin") {
    const dir = join(pluginDir, args.at(-1)!);
    mkdirSync(dir, { recursive: true }); // the CLI builds the folder; the cache checks it is still there
    return dir;
  }
  throw new Error(`unexpected nexo call ${args.join(" ")}`);
};
const count = (sub: string) => cli.filter((c) => c[1] === sub).length;

type Args = { prompt: AsyncIterable<any>; options: any };
const sdk: Args[] = [];
const SID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
agent.setQueryFn(((a: Args) => {
  sdk.push(a);
  return (async function* () {
    yield { type: "system", subtype: "init", session_id: SID, model: "m", skills: [], permissionMode: "default" };
    yield { type: "result", subtype: "success", is_error: false, session_id: SID, total_cost_usd: 0, num_turns: 1, duration_ms: 1, result: "done" };
  })();
}) as any);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>): Promise<NonNullable<T>> {
  for (let i = 0; i < 400; i++) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    await sleep(10);
  }
  throw new Error("timed out");
}
const tab = async (id: string) => ((await m.get("/tabs")).body as any[]).find((t) => t.id === id);
const idle = (id: string) => until(async () => !(await tab(id)).running);
const open = async () => ((await m.call("POST", "/tabs", { project: "shop" })).body as { id: string }).id;
const send = (id: string, body: Record<string, unknown> = {}) => m.call("POST", `/tabs/${id}/send`, { prompt: "go", ...body });
const setDefault = (name?: string) => {
  const file = join(env.root, CONFIG_FILE);
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  if (name) cfg.framework = name;
  else delete cfg.framework;
  writeFileSync(file, JSON.stringify(cfg));
};
async function lastEvents(id: string) {
  const res = await fetch(`${m.base}/tabs/${id}/stream`);
  const reader = res.body!.getReader();
  let buf = "";
  const out: any[] = [];
  while (!out.some((e) => e.kind === "replay_done")) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
    const parts = buf.split("\n\n");
    buf = parts.pop()!;
    for (const p of parts) out.push(JSON.parse(p.replace(/^data: /, "")));
  }
  await reader.cancel();
  return out;
}

test("the composer's list: nexo's default and only the enabled methods (not tools, not off ones)", async () => {
  const r = await m.get("/sessions/frameworks");
  assert.deepEqual(r.body, { default: "nexo", methods: [{ name: "corp", version: "1.0.0" }] });
  setDefault("corp");
  assert.equal((await m.get("/sessions/frameworks")).body.default, "corp", "read live, no restart");
  setDefault();
});

test("a Claude turn with a framework gets its plugin and marked instructions after the environment's note; it sticks", async () => {
  const id = await open();
  assert.equal((await tab(id)).framework, null);
  assert.equal((await send(id, { framework: "corp" })).status, 200);
  await idle(id);
  const o = sdk.at(-1)!.options;
  assert.deepEqual(o.plugins, [{ type: "local", path: join(pluginDir, "corp") }]);
  const append: string = o.systemPrompt.append;
  assert.ok(append.startsWith("Session launched from agent-os-nexo"), "the environment's note comes first");
  assert.match(append, /Instructions of the corp framework \(third party\)[\s\S]*environment's own rules[\s\S]*Always write tests first\./);
  assert.equal((await tab(id)).framework, "corp");
  // the next turn keeps it without the body naming it, and the plugin is built once (cached)
  const plugins = count("plugin");
  await send(id);
  await idle(id);
  assert.equal(sdk.at(-1)!.options.plugins[0].path, join(pluginDir, "corp"));
  assert.equal(count("plugin"), plugins);
  // it is saved with the tabs
  assert.equal(JSON.parse(readFileSync(agent.tabsFileName(join(env.os, "data", "sessions")), "utf8")).find((t: any) => t.id === id).framework, "corp");
  agent.closeTab(id);
});

test("with no choice a tab follows the environment's default, read live; an explicit nexo sticks and means none", async () => {
  setDefault("corp");
  const a = await open();
  await send(a);
  await idle(a);
  assert.equal(sdk.at(-1)!.options.plugins[0].path, join(pluginDir, "corp"));
  assert.equal((await tab(a)).framework, null, "following the default is not a choice");
  setDefault();
  await send(a);
  await idle(a);
  assert.equal(sdk.at(-1)!.options.plugins, undefined, "default went back to nexo");
  assert.doesNotMatch(sdk.at(-1)!.options.systemPrompt.append, /third party/);

  setDefault("corp");
  const b = await open();
  await send(b, { framework: "nexo" });
  await idle(b);
  assert.equal(sdk.at(-1)!.options.plugins, undefined);
  assert.equal((await tab(b)).framework, "nexo");
  setDefault();
  agent.closeTab(a);
  agent.closeTab(b);
});

test("the body is validated: only nexo or an enabled method; a refusal does not stick or run anything", async () => {
  const id = await open();
  const before = sdk.length;
  for (const framework of ["off", "dbtool", "ghost", "Bad Name", "../x", 7]) {
    assert.equal((await send(id, { framework })).status, 400, String(framework));
  }
  assert.equal(sdk.length, before);
  assert.equal((await tab(id)).framework, null);
  assert.equal((await send(id, { framework: "nexo" })).status, 200);
  await idle(id);
  agent.closeTab(id);
});

test("a framework disabled after the tab chose it fails the turn clearly instead of running without it", async () => {
  const id = await open();
  await send(id, { framework: "corp" });
  await idle(id);
  frameworks = [entry("corp", { enabled: false })];
  bumpFrameworks();
  const before = sdk.length;
  await send(id);
  await idle(id);
  assert.equal(sdk.length, before, "no SDK query");
  const err = (await lastEvents(id)).filter((e) => e.kind === "error").at(-1);
  assert.match(err.text, /"corp" is not available any more/);
  frameworks = [entry("corp"), entry("off", { enabled: false }), entry("dbtool", { kind: "tool" })];
  bumpFrameworks();
  agent.closeTab(id);
});

test("the plugin is rebuilt when the framework's entry changes, and a path outside the environment is refused", async () => {
  const id = await open();
  await send(id, { framework: "corp" });
  await idle(id);
  const plugins = count("plugin");
  frameworks = [entry("corp", { version: "1.1.0", hooksApproved: true, hookCommands: ["node g.js"] })];
  bumpFrameworks();
  await send(id);
  await idle(id);
  assert.equal(count("plugin"), plugins + 1);

  instructions = "Other rules.";
  frameworks = [entry("corp", { version: "1.2.0" })];
  bumpFrameworks();
  pluginDir = tempDir("outside-plugins-");
  const before = sdk.length;
  await send(id);
  await idle(id);
  assert.equal(sdk.length, before);
  assert.match((await lastEvents(id)).filter((e) => e.kind === "error").at(-1).text, /unexpected plugin path/);
  pluginDir = join(env.root, ".state", "nexo", "plugins");
  frameworks = [entry("corp"), entry("off", { enabled: false }), entry("dbtool", { kind: "tool" })];
  instructions = "Always write tests first.";
  bumpFrameworks();
  agent.closeTab(id);
});

test("a CLI provider gets the instructions in front of the prompt, marked; no plugin is built", async () => {
  const realRun = providers.providerExec.run;
  const realFind = providers.providerExec.find;
  const asked: string[][] = [];
  providers.providerExec.find = (n: string) => (n === "opencode" ? "/fake/opencode" : null);
  providers.providerExec.run = ((_cmd: string, args: string[]) => (asked.push(args), Promise.resolve({ stdout: "ok", stderr: "" }))) as unknown as typeof providers.providerExec.run;
  try {
    const id = await open();
    const plugins = count("plugin");
    assert.equal((await send(id, { provider: "opencode", framework: "corp" })).status, 200);
    await idle(id);
    const prompt = asked[0]!.at(-1)!;
    assert.match(prompt, /^Instructions of the corp framework \(third party\)[\s\S]*Always write tests first\.\n\n---\n\ngo$/);
    assert.equal(count("plugin"), plugins, "CLI providers do not load plugins");
    // a second turn: the framework sticks, history follows the instructions
    await send(id, { prompt: "again" });
    await idle(id);
    assert.match(asked[1]!.at(-1)!, /Always write tests first\.\n\n---\n\nUser: go\nAssistant: ok\n\nagain$/);
    // nexo: the prompt is untouched
    await send(id, { prompt: "plain", framework: "nexo" });
    await idle(id);
    assert.doesNotMatch(asked[2]!.at(-1)!, /third party/);
    agent.closeTab(id);

    // instructions that cannot fit the argument fail the turn instead of being cut
    instructions = "x".repeat(providers.MAX_PROMPT_ARG);
    bumpFrameworks();
    fw.useFrameworks(env);
    const big = await open();
    await send(big, { provider: "opencode", framework: "corp" });
    await idle(big);
    assert.match((await lastEvents(big)).filter((e) => e.kind === "error").at(-1).text, /instructions are too long/);
    instructions = "Always write tests first.";
    agent.closeTab(big);
  } finally {
    providers.providerExec.run = realRun;
    providers.providerExec.find = realFind;
  }
});

test("long history is trimmed from its oldest lines to leave room for the instructions", async () => {
  const realRun = providers.providerExec.run;
  const realFind = providers.providerExec.find;
  const asked: string[][] = [];
  providers.providerExec.find = (n: string) => (n === "opencode" ? "/fake/opencode" : null);
  providers.providerExec.run = ((_cmd: string, args: string[]) => (asked.push(args), Promise.resolve({ stdout: "a".repeat(40_000), stderr: "" }))) as unknown as typeof providers.providerExec.run;
  try {
    bumpFrameworks();
    fw.useFrameworks(env);
    instructions = "y".repeat(60_000);
    const id = await open();
    await send(id, { provider: "opencode", framework: "corp", prompt: "first" });
    await idle(id);
    await send(id, { prompt: "second" });
    await idle(id);
    await send(id, { prompt: "third" });
    await idle(id);
    for (const a of asked) assert.ok(a.at(-1)!.length <= providers.MAX_PROMPT_ARG);
    assert.match(asked.at(-1)!.at(-1)!, /third$/);
    instructions = "Always write tests first.";
    agent.closeTab(id);
  } finally {
    providers.providerExec.run = realRun;
    providers.providerExec.find = realFind;
  }
});

test("without a CLI that can list frameworks nothing is offered, and a named framework is refused", async () => {
  const real = fw.deps.nexo;
  fw.deps.nexo = async () => {
    throw new Error("nexo is gone");
  };
  bumpFrameworks();
  try {
    assert.deepEqual((await m.get("/sessions/frameworks")).body.methods, []);
    const id = await open();
    assert.equal((await send(id, { framework: "corp" })).status, 400);
    agent.closeTab(id);
  } finally {
    fw.deps.nexo = real;
    bumpFrameworks();
  }
});

test("markInstructions names the framework and keeps the environment's rules above it", () => {
  const text = fw.markInstructions("corp", "Be nice.");
  assert.match(text, /^Instructions of the corp framework \(third party\)\./);
  assert.match(text, /AGENTS\.md and the permissions\) always win/);
  assert.ok(text.endsWith("Be nice."));
  fw.useFrameworks(env);
  assert.equal(fw.defaultFramework(), "nexo");
});
