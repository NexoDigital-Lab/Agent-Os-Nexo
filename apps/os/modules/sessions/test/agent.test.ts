// The agent runtime (agent.ts) and the module's routes (index.ts) through real HTTP, with a fake SDK stream:
// tabs, a full turn, permission prompts, quick prompts, interrupt, restore, resume, uploads, skills and search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, tempEnv, mountModule } from "../../../host/test/harness.ts";

// ~/.claude/projects is read through os.homedir(): point HOME at a temp folder before the modules load.
const home = tempDir("agent-home-");
process.env.HOME = home;
process.env.USERPROFILE = home;
const env = tempEnv();
mkdirSync(join(env.projects, "shop", "code"), { recursive: true });
writeFileSync(join(env.projects, "shop", "AGENTS.md"), "# shop");
writeFileSync(join(env.projects, "shop", "code", "a.txt"), "hello");
execFileSync("git", ["init", "-q"], { cwd: join(env.projects, "shop", "code") });
mkdirSync(join(env.projects, "other"), { recursive: true });
writeFileSync(join(env.projects, "other", "AGENTS.md"), "# other"); // a project without code/

const agent = await import("../server/agent.ts");
const { default: register } = await import("../server/index.ts");
const { initProjects } = await import("../../projects/server/projects.ts");
const { projectHooks } = await import("../../projects/server/hooks.ts");
const { contributeToSessions } = await import("../server/contributions.ts");
initProjects(env);
// stateDir outside ".state": express's sendFile treats a dot-folder anywhere in an absolute path as hidden (404).
const m = await mountModule(register, { env, id: "sessions", stateDir: join(tempDir("agent-state-"), "sessions") });

// ---- the fake SDK -------------------------------------------------------------------------------------------
type Args = { prompt: AsyncIterable<any>; options: any };
const stopped: string[] = [];
let script: (a: Args) => AsyncGenerator<unknown> = async function* () {};
const calls: Args[] = [];
agent.setQueryFn(((a: Args) => {
  calls.push(a);
  return Object.assign(script(a), { stopTask: async (id: string) => void stopped.push(id) });
}) as any);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, what = "condition"): Promise<NonNullable<T>> {
  for (let i = 0; i < 400; i++) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};
const tabs = async () => (await m.get("/tabs")).body as any[];
const tab = async (id: string) => (await tabs()).find((t) => t.id === id);
const idle = (id: string) => until(async () => !(await tab(id)).running, "the turn to end");

/** Events replayed by the SSE stream, up to the replay_done marker. */
async function events(id: string) {
  const res = await fetch(`${m.base}/tabs/${id}/stream`);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
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
const SID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const init = { type: "system", subtype: "init", session_id: SID, model: "m", skills: [], permissionMode: "default" };
const result = (extra = {}) => ({ type: "result", subtype: "success", is_error: false, session_id: SID, total_cost_usd: 0.5, num_turns: 1, duration_ms: 5, result: "done", ...extra });
const send = (id: string, body: Record<string, unknown> = {}) => m.call("POST", `/tabs/${id}/send`, { prompt: "go", ...body });
const open = async (title?: string) => ((await m.call("POST", "/tabs", { project: "shop", ...(title ? { title } : {}) })).body as { id: string }).id;

// ---- tabs -----------------------------------------------------------------------------------------------------
test("opening tabs: validates the project and worktree, defaults the title to the project name", async () => {
  assert.equal((await m.call("POST", "/tabs", { project: "nope" })).status, 404);
  assert.equal((await m.call("POST", "/tabs", { project: "other" })).status, 404, "no code/ yet");
  const bad = await m.call("POST", "/tabs", { project: "shop", worktree: "ghost" });
  assert.equal(bad.status, 404);
  assert.match(bad.body.error, /Unknown worktree/);
  const id = await open();
  const t = await tab(id);
  assert.equal(t.title, "shop");
  assert.equal(t.project, "shop");
  assert.equal(t.cwd, join(env.projects, "shop", "code"));
  assert.equal(t.status, "idle");
  assert.equal(t.sdkSessionId, null);
  assert.equal(t.workStatus, null);
  assert.equal((await m.call("PATCH", `/tabs/${id}`, { title: "Renamed" })).status, 200);
  assert.equal((await tab(id)).title, "Renamed");
  agent.renameTab("missing", "x");
  assert.equal((await m.call("GET", `/tabs/${id}/diff`)).status, 200);
  assert.equal((await m.call("GET", "/tabs/missing/diff")).status, 404);
  assert.equal(agent.tabContext("missing"), null);
  assert.equal(agent.tabCwd(id), t.cwd);
  assert.throws(() => agent.tabCwd("missing"), (e: any) => e.status === 404);
  assert.equal((await m.call("DELETE", `/tabs/${id}`)).status, 200);
  assert.equal(await tab(id), undefined);
  agent.closeTab(id); // closing twice is harmless
});

test("setTabMeta sets and clears a module's value; emitTo ignores unknown tabs", async () => {
  const id = await open();
  agent.setTabMeta(id, "archOff", true);
  assert.deepEqual(agent.tabContext(id)!.meta, { archOff: true });
  agent.setTabMeta(id, "archOff", null);
  assert.deepEqual(agent.tabContext(id)!.meta, {});
  agent.emitTo("missing", { kind: "note", text: "x" });
  agent.emitTo(id, { kind: "note", text: "hello" });
  assert.ok((await events(id)).some((e) => e.kind === "note" && e.text === "hello"));
  assert.throws(() => agent.setTabMeta("missing", "k", 1), (e: any) => e.status === 404);
  agent.closeTab(id);
});

// ---- a full turn ---------------------------------------------------------------------------------------------
test("a turn: events stream, contributions take part, status goes done then idle once seen", async () => {
  const log: string[] = [];
  contributeToSessions({
    promptNote: () => "NOTE-FROM-MODULE",
    env: () => ({ FROM_MODULE: "1" }),
    mcpServers: () => ({ extra: { type: "sdk", name: "extra" } as any }),
    autoAllow: (_t, tool) => tool === "AutoTool",
    onMessage: (_t, msg) => void log.push(`msg:${msg.type}`),
    onTurnEnd: (_t, info) => void log.push(`end:${info.ok}:${info.turns}`),
    onClose: () => void log.push("closed"),
  });
  let broken = true; // only the first turn runs with a failing contribution
  contributeToSessions({ promptNote: () => { if (broken) throw new Error("broken note"); return null; }, env: () => { if (broken) throw new Error("broken env"); return null; } });
  const consoleError = console.error;
  console.error = () => {};
  const id = await open("work");
  script = async function* () {
    yield init;
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "thinking" }, { type: "tool_use", id: "t1", name: "Read", input: {} }] } };
    yield result({ num_turns: 3 });
  };
  try {
    assert.equal((await send(id, { skills: ["alpha"], images: ["img-1.png"], mode: "plan", model: "haiku", workMode: "focus" })).status, 200);
    await idle(id);
  } finally {
    console.error = consoleError;
    broken = false;
  }
  const opts = calls.at(-1)!.options;
  assert.equal(opts.cwd, join(env.projects, "shop"));
  assert.equal(opts.model, "haiku");
  assert.equal(opts.permissionMode, "plan");
  assert.equal(opts.allowDangerouslySkipPermissions, false);
  assert.deepEqual(opts.skills, ["alpha"]);
  assert.equal(opts.env.FROM_MODULE, "1");
  assert.ok(opts.mcpServers.work && opts.mcpServers.extra);
  assert.ok(opts.hooks.PreToolUse.length >= 1, "the os guard is registered");
  assert.match(opts.systemPrompt.append, /project shop; the repository is code\//);
  assert.match(opts.systemPrompt.append, /skill loadout for the task: alpha/);
  assert.match(opts.systemPrompt.append, /Work mode: FOCUS/);
  assert.match(opts.systemPrompt.append, /NOTE-FROM-MODULE/);
  assert.match(opts.systemPrompt.append, /set_work_status/);
  const evs = await events(id);
  assert.deepEqual(evs.map((e) => e.kind), ["status", "user", "init", "text", "tool", "activity", "result", "activity", "status", "status", "replay_done"]);
  assert.deepEqual(evs[1].images, [], "an image that was never uploaded is dropped");
  assert.deepEqual(log.filter((l) => l !== "msg:system" && l !== "msg:assistant"), ["msg:result", "end:true:3"]);
  const t = await tab(id);
  assert.equal(t.cost, 0.5);
  assert.equal(t.sdkSessionId, SID);
  assert.equal(t.status, "done");
  assert.equal(agent.tabForSession(SID), id);
  assert.equal(agent.tabForSession("nope"), null);
  await m.call("POST", `/tabs/${id}/seen`);
  assert.equal((await tab(id)).status, "idle");
  agent.markSeen("missing");
  await m.call("DELETE", `/tabs/${id}`);
  assert.ok(log.includes("closed"));
});

test("send validates the body and the tab; a failing query becomes an error event and status", async () => {
  const id = await open();
  assert.equal((await send("missing")).status, 404);
  assert.equal((await m.call("POST", `/tabs/${id}/send`, {})).status, 400);
  script = async function* () {
    throw new Error("kaboom");
  };
  await send(id);
  await idle(id);
  assert.ok((await events(id)).some((e) => e.kind === "error" && e.text === "kaboom"));
  assert.equal((await tab(id)).status, "error");
  script = async function* () {
    throw "plain string";
  };
  await send(id);
  await idle(id);
  assert.ok((await events(id)).some((e) => e.kind === "error" && e.text === "plain string"));
  agent.closeTab(id);
});

test("an error result ends the turn as an error; bypassPermissions allows dangerous skipping", async () => {
  const id = await open();
  script = async function* () {
    yield init;
    yield result({ subtype: "error_max_turns", is_error: true });
  };
  await send(id, { mode: "bypassPermissions" });
  await idle(id);
  assert.equal(calls.at(-1)!.options.allowDangerouslySkipPermissions, true);
  assert.equal((await tab(id)).status, "error");
  agent.closeTab(id);
});

// ---- permissions, interrupt, quick prompts ----------------------------------------------------------------------
test("permission prompts: auto-allowed tools pass, others wait for the user (allow always / deny), 409 while running", async () => {
  const id = await open();
  const finish = gate();
  const answers: any[] = [];
  const suggestions = [
    { type: "addRules", behavior: "allow", destination: "localSettings", rules: [{ toolName: "Bash", ruleContent: "ls:*" }, { toolName: "Read" }] },
    { type: "addDirectories", destination: "userSettings", directories: ["/data"] },
    { type: "addRules", behavior: "deny", destination: "session", rules: [{ toolName: "X" }] },
    { type: "setMode", destination: "session", mode: "plan" },
  ];
  script = async function* ({ options }) {
    yield init;
    const sig = new AbortController().signal;
    answers.push(await options.canUseTool("mcp__work__set_work_status", { a: 1 }, { signal: sig }));
    answers.push(await options.canUseTool("AutoTool", {}, { signal: sig }));
    answers.push(await options.canUseTool("Bash", { command: "ls" }, { signal: sig, suggestions }));
    answers.push(await options.canUseTool("Write", {}, { signal: sig }));
    await finish.p;
    yield result();
  };
  await send(id);
  const first = await until(async () => (await events(id)).find((e) => e.kind === "perm"), "the first prompt");
  assert.equal(first.tool, "Bash");
  assert.deepEqual(first.always, { rules: ["Bash(ls:*)", "Read", "access to /data"], where: "the project's .claude/settings.local.json, ~/.claude/settings.json, this session" });
  assert.equal((await tab(id)).status, "needs_you");
  assert.equal((await send(id)).status, 409);
  assert.equal((await m.call("POST", `/tabs/${id}/permission`, { permId: "nope", allow: true })).body.ok, false);
  assert.equal((await m.call("POST", `/tabs/${id}/permission`, { permId: first.id, allow: true, always: true })).body.ok, true);
  const second = await until(async () => (await events(id)).find((e) => e.kind === "perm" && e.tool === "Write"), "the second prompt");
  assert.equal(second.always, undefined, "no suggestions: nothing to remember");
  await m.call("POST", `/tabs/${id}/permission`, { permId: second.id, allow: false });
  await until(() => answers.length === 4, "all answers");
  finish.open();
  await idle(id);
  assert.deepEqual(answers[0], { behavior: "allow", updatedInput: { a: 1 } });
  assert.equal(answers[1].behavior, "allow");
  assert.equal(answers[2].behavior, "allow");
  assert.equal(answers[2].updatedPermissions.length, 3, "setMode suggestions are never saved");
  assert.equal(answers[3].behavior, "deny");
  assert.match(answers[3].message, /denied it from agent-os/);
  assert.ok((await events(id)).some((e) => e.kind === "perm_done" && e.id === first.id && e.allow));
  agent.closeTab(id);
});

test("an allow without 'always' carries no saved rules", async () => {
  const id = await open();
  let answer: any;
  script = async function* ({ options }) {
    yield init;
    answer = await options.canUseTool("Bash", {}, { signal: new AbortController().signal, suggestions: [{ type: "addRules", behavior: "allow", destination: "session", rules: [{ toolName: "Bash" }] }] });
    yield result();
  };
  await send(id);
  const p = await until(async () => (await events(id)).find((e) => e.kind === "perm"), "the prompt");
  await m.call("POST", `/tabs/${id}/permission`, { permId: p.id, allow: true });
  await idle(id);
  assert.deepEqual(answer, { behavior: "allow" });
  agent.closeTab(id);
});

test("interrupt aborts a pending prompt and the turn ends quietly (not an error)", async () => {
  const id = await open();
  let answer: any;
  script = async function* ({ options }) {
    yield init;
    answer = await options.canUseTool("Bash", {}, { signal: options.abortController.signal });
    throw new Error("aborted by the user");
  };
  await send(id);
  await until(async () => (await events(id)).find((e) => e.kind === "perm"), "the prompt");
  assert.equal((await m.call("POST", `/tabs/${id}/interrupt`)).status, 200);
  await idle(id);
  assert.deepEqual(answer, { behavior: "deny", message: "aborted" });
  assert.equal((await tab(id)).status, "idle", "stopped by the user is not news");
  agent.interrupt("missing");
  agent.closeTab(id);
});

test("quick prompts: idle sends a turn; running folds into the stream; a closing turn queues for the next", async () => {
  const id = await open();
  script = async function* () {
    yield init;
    yield result();
  };
  assert.equal((await m.call("POST", `/tabs/${id}/quick`, { text: "first" })).body.queued, false, "idle: a normal send");
  await idle(id);
  const seen: string[] = [];
  const release = gate();
  const afterResult = gate();
  script = async function* ({ prompt }) {
    const it = prompt[Symbol.asyncIterator]();
    seen.push((await it.next()).value.message.content);
    yield init;
    seen.push((await it.next()).value.message.content); // the quick prompt arrives mid-turn
    yield result({ queued_turn_count: 1 });
    await release.p;
    yield result();
    await afterResult.p;
  };
  await send(id, { prompt: "main task", skills: ["s"], mode: "acceptEdits" });
  await until(() => seen.length === 1, "the first message");
  assert.equal(seen[0], "main task");
  const q = await m.call("POST", `/tabs/${id}/quick`, { text: "also do this" });
  assert.deepEqual(q.body, { queued: true });
  await until(() => seen.length === 2, "the quick message");
  assert.equal(seen[1], "also do this");
  release.open();
  // Results so far: the idle quick turn's, then this turn's queued one and its closing one.
  await until(async () => (await events(id)).filter((e) => e.kind === "result").length === 3, "the closing result");
  await sleep(50); // the loop closes the input right after the result
  // The input is closed now but the turn has not finished: this one waits for it.
  const late = await m.call("POST", `/tabs/${id}/quick`, { text: "late one" });
  assert.deepEqual(late.body, { queued: true });
  assert.ok((await events(id)).some((e) => e.kind === "note" && /Queued/.test(e.text)));
  script = async function* ({ prompt }) {
    const it = prompt[Symbol.asyncIterator]();
    seen.push((await it.next()).value.message.content);
    yield result();
  };
  afterResult.open();
  await until(() => seen.length === 3, "the queued turn");
  assert.equal(seen[2], "late one");
  assert.equal(calls.at(-1)!.options.permissionMode, "acceptEdits", "the queued turn reuses the last mode");
  await idle(id);
  agent.closeTab(id);
});

test("a quick prompt aimed at a subagent stops it first, and stopTask needs a running turn", async () => {
  const id = await open();
  assert.equal((await m.call("POST", `/tabs/${id}/tasks/t1/stop`)).status, 409);
  const release = gate();
  const seen: string[] = [];
  script = async function* ({ prompt }) {
    const it = prompt[Symbol.asyncIterator]();
    await it.next();
    yield init;
    yield { type: "system", subtype: "task_started", task_id: "t1", subagent_type: "explore", description: "looking" };
    seen.push((await it.next()).value.message.content);
    await release.p;
    yield result();
  };
  await send(id);
  await until(async () => (await events(id)).some((e) => e.kind === "task"), "the subagent");
  assert.equal((await m.call("POST", `/tabs/${id}/tasks/t1/stop`)).status, 200);
  await m.call("POST", `/tabs/${id}/quick`, { text: "change course", target: "t1" });
  await until(() => seen.length === 1, "the redirect message");
  assert.match(seen[0]!, /subagent "explore · looking", which I just stopped\] change course/);
  assert.deepEqual(stopped, ["t1", "t1"]);
  assert.ok((await events(id)).some((e) => e.kind === "user" && e.quick === "explore · looking"));
  release.open();
  await idle(id);
  agent.closeTab(id);
});

test("the work tool sets the tab's work status and it is listed", async () => {
  const id = await open();
  script = async function* ({ options }) {
    yield init;
    await options.mcpServers.work.instance._registeredTools.set_work_status.handler({ status: "doing", note: "on it" }, {});
    yield result();
  };
  await send(id);
  await idle(id);
  assert.equal((await tab(id)).workStatus.status, "doing");
  agent.closeTab(id);
});

// ---- persistence, resume ---------------------------------------------------------------------------------------
const projectsDir = join(home, ".claude", "projects", "-proj");
mkdirSync(projectsDir, { recursive: true });
const transcript = (id: string, cwd: string, text: string) => {
  const row = (r: unknown) => JSON.stringify(r);
  writeFileSync(
    join(projectsDir, `${id}.jsonl`),
    [
      row({ type: "user", timestamp: "2026-01-01T10:00:00Z", cwd, entrypoint: "cli", message: { content: text } }),
      row({ type: "assistant", timestamp: "2026-01-01T10:01:00Z", uuid: "u", message: { id: "m", model: "claude-sonnet-4", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: "ok" }] } }),
    ].join("\n") + "\n",
  );
};

test("tabs are saved and restored with their history; uploads of closed tabs are pruned", async () => {
  const id = await open("kept");
  script = async function* () {
    yield init;
    yield result();
  };
  await send(id);
  await idle(id);
  transcript(SID, join(env.projects, "shop", "code"), "earlier question");
  await m.call("POST", "/tabs", { project: "shop", title: "second" }); // persists the session id above too
  const file = agent.tabsFileName(m.ctx.dataDir);
  const saved = JSON.parse((await import("node:fs")).readFileSync(file, "utf8"));
  assert.ok(saved.some((t: any) => t.id === id && t.sdkSessionId === SID));
  agent.restoreTabs(file);
  const evs = await events(id);
  assert.equal(evs[0].text, "earlier question");
  assert.ok(evs.some((e) => e.kind === "note" && /agent-os restarted/.test(e.text)));
  writeFileSync(file, "{ not json");
  agent.restoreTabs(file); // a damaged file does not stop the app and keeps the tabs in memory
  assert.equal((await tab(id)).title, "kept");
  writeFileSync(file, JSON.stringify({ not: "an array" }));
  agent.restoreTabs(file);
  agent.closeTab(id);
});

test("recent sessions list and resume: reuse an open tab, fork a live session, errors for missing ones", async () => {
  const cwdInProject = join(env.projects, "shop", "code");
  const S1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const S2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const S3 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const outside = tempDir("outside-cwd-");
  transcript(S1, cwdInProject, "in the project");
  transcript(S2, outside, "outside");
  transcript(S3, join(outside, "gone"), "folder removed");
  const list = (await m.get("/sessions/history?limit=50")).body as any[];
  const s1 = list.find((s) => s.id === S1);
  assert.equal(s1.project, "shop");
  assert.equal(s1.tabId, null);
  assert.equal((await m.get("/sessions/history?limit=1")).body.length, 1);

  assert.equal((await m.call("POST", `/sessions/history/${"e".repeat(8)}/resume`)).status, 404);
  assert.equal((await m.call("POST", `/sessions/history/${S3}/resume`)).status, 410);

  const r1 = (await m.call("POST", `/sessions/history/${S1}/resume`)).body;
  assert.equal(r1.reused, false);
  assert.equal(r1.forked, true, "just written: still live elsewhere");
  const t1 = await tab(r1.id);
  assert.equal(t1.project, "shop");
  assert.equal(t1.sdkSessionId, S1);
  assert.deepEqual((await m.call("POST", `/sessions/history/${S1}/resume`)).body, { id: r1.id, reused: true });
  assert.ok((await events(r1.id)).some((e) => e.kind === "note" && /resumed as a copy/.test(e.text)));

  const r2 = (await m.call("POST", `/sessions/history/${S2}/resume`)).body;
  const t2 = await tab(r2.id);
  assert.equal(t2.project, "");
  assert.equal(t2.dir, outside);
  assert.equal(t2.cwd, outside);

  const id3 = agent.resumeTab({ project: "", dir: outside, cwd: outside, title: "plain", sdkSessionId: "x", fork: false, history: [] });
  assert.ok((await events(id3)).some((e) => e.kind === "note" && /continues this conversation/.test(e.text)));
  for (const id of [r1.id, r2.id, id3]) agent.closeTab(id);
});

test("project hooks report a project's tabs and close them before deletion", async () => {
  const before = agent.listTabs().filter((t) => t.project === "shop").length;
  const id = await open();
  const hook = projectHooks().find((h) => h.deleteFacts)!;
  const project = { id: "shop" } as any;
  assert.deepEqual(await hook.deleteFacts!(project), { openTabs: before + 1, runningTabs: 0 });
  await hook.beforeLocalDelete!(project);
  assert.equal(await tab(id), undefined);
  assert.equal(agent.listTabs().filter((t) => t.project === "shop").length, 0);
});

test("onTabClose listeners run when a tab closes", async () => {
  const closed: string[] = [];
  agent.onTabClose((x) => void closed.push(x));
  let breakListener = true;
  agent.onTabClose(() => { if (breakListener) throw new Error("listener broke"); });
  const consoleError = console.error;
  console.error = () => {};
  const id = await open();
  try {
    agent.closeTab(id);
  } finally {
    console.error = consoleError;
    breakListener = false;
  }
  assert.deepEqual(closed, [id]);
});

// ---- uploads, skills, search -----------------------------------------------------------------------------------
test("image uploads: save, serve, delete; empty or unknown format is 415", async () => {
  const id = await open();
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const up = await fetch(`${m.base}/tabs/${id}/uploads`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
  assert.equal(up.status, 200);
  const { name, url } = (await up.json()) as { name: string; url: string };
  assert.equal(url, `/api/tabs/${id}/uploads/${name}`);
  const got = await fetch(m.base + url.slice(4));
  assert.equal(got.status, 200);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);
  assert.equal((await fetch(`${m.base}/tabs/${id}/uploads`, { method: "POST", headers: { "content-type": "image/png" }, body: Buffer.alloc(0) })).status, 415);
  assert.equal((await fetch(`${m.base}/tabs/${id}/uploads`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status, 415);
  assert.equal((await fetch(`${m.base}/tabs/missing/uploads`, { method: "POST", headers: { "content-type": "image/png" }, body: png })).status, 404);
  // An uploaded image is attached to the next message and its path given to the model.
  let content: any;
  script = async function* ({ prompt }) {
    content = (await prompt[Symbol.asyncIterator]().next()).value.message.content;
    yield result();
  };
  await send(id, { images: [name] });
  await idle(id);
  assert.equal(content[0].type, "image");
  assert.match(content[1].text, /1 image\(s\) attached/);
  assert.ok((await events(id)).some((e) => e.kind === "user" && e.images[0] === url));
  assert.equal((await m.call("DELETE", `/tabs/${id}/uploads/${name}`)).status, 200);
  assert.equal((await fetch(m.base + url.slice(4))).status, 404);
  agent.closeTab(id);
});

test("skills routes: list, save prefs and read them back", async () => {
  mkdirSync(join(env.library, "skills", "demo"), { recursive: true });
  writeFileSync(join(env.library, "skills", "demo", "SKILL.md"), "---\ndescription: A demo.\n---\nbody");
  const list = (await m.get("/sessions/skills")).body as any[];
  assert.ok(list.some((s) => s.name === "demo" && s.enabled));
  const put = await m.call("PUT", "/sessions/skills/prefs", { disabled: ["demo"], pinned: [] });
  assert.deepEqual(put.body, { disabled: ["demo"], pinned: [] });
  assert.equal(((await m.get("/sessions/skills")).body as any[]).find((s) => s.name === "demo").enabled, false);
  assert.deepEqual((await m.call("PUT", "/sessions/skills/prefs", {})).body, { disabled: [], pinned: [] });
});

test("search routes: query, project filter, and id validation for 'around'", async () => {
  const hits = await m.get("/sessions/search?q=question&limit=5");
  assert.equal(hits.status, 200);
  assert.ok(Array.isArray(hits.body));
  assert.equal((await m.get("/sessions/search?q=question&project=shop")).status, 200);
  assert.equal((await m.get("/sessions/not-an-id/around")).status, 400);
  const around = await m.get(`/sessions/${SID}/around?at=2026-01-01T10:00:00Z&n=1`);
  assert.equal(around.status, 200);
});
