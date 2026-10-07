// The ssh routes: vault forms and cookie gate, saved accesses, tab consoles, plan decisions, and the contributions the
// module hands to sessions. The pty is a fake: no ssh process is ever started.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { closeTab, listTabs, openTab, restoreTabs } from "../../sessions/server/agent.ts";
import { contributions } from "../../sessions/server/contributions.ts";
import type { Ev } from "../../sessions/server/sdkEvents.ts";
import register from "../server/index.ts";
import { deps, kill, setShared, status, type PtyLike } from "../server/session.ts";
import { sshHandlers } from "../server/tools.ts";

class FakePty implements PtyLike {
  written: string[] = [];
  killed = false;
  private data: Array<(d: string) => void> = [];
  write = (d: string) => void this.written.push(d);
  resize = () => {};
  kill = () => void (this.killed = true);
  onData = (cb: (d: string) => void) => this.data.push(cb);
  onExit = () => {};
  emit = (d: string) => this.data.forEach((cb) => cb(d));
}
const CONNECTED = "\x1b]0;agos-ok\x07";
let launchFails = false;
const ptys: FakePty[] = [];
deps.spawn = () => {
  if (launchFails) throw new Error("no ssh binary");
  const p = new FakePty();
  ptys.push(p);
  return p;
};

const env = tempEnv();
initProjects(env);
restoreTabs(join(env.state, "tabs.json"));
const shop = join(env.projects, "shop");
mkdirSync(join(shop, "code"), { recursive: true });
writeFileSync(join(shop, "AGENTS.md"), "# shop\n");

const m = await mountModule(register, { env });
let cookie = "";
const api = async (method: string, path: string, body?: unknown, withCookie = true) => {
  const res = await fetch(m.base + path, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(withCookie && cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
};
const PASSWORD = "a long master password";
const goodHost = { name: "web", host: "10.0.0.5", port: 22, user: "deploy", auth: "password", project: null, secret: "pw" };

test("the state is public; every other route needs the vault cookie", async () => {
  assert.deepEqual((await api("GET", "/ssh/state", undefined, false)).body, { state: "setup" });
  const locked = await api("GET", "/ssh/hosts", undefined, false);
  assert.equal(locked.status, 401);
  assert.equal(locked.body.locked, true);
  assert.equal((await api("POST", "/ssh/lock", {}, false)).status, 401);
});

test("setup needs a long enough password, then hands out the cookie", async () => {
  assert.equal((await api("POST", "/ssh/setup", {}, false)).status, 400);
  assert.equal((await api("POST", "/ssh/setup", { password: 12345678901234 }, false)).status, 400);
  const short = await api("POST", "/ssh/setup", { password: "short" }, false);
  assert.equal(short.status, 400);
  assert.match(short.body.error, /at least 12/);
  const ok = await api("POST", "/ssh/setup", { password: PASSWORD }, false);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { state: "unlocked" });
  const set = ok.headers.get("set-cookie")!;
  assert.match(set, /^nexo_ssh=.+; HttpOnly; SameSite=Strict; Path=\/api\/ssh$/);
  cookie = set.split(";")[0]!;
  assert.deepEqual((await api("GET", "/ssh/hosts")).body, []);
  assert.equal((await api("GET", "/ssh/hosts", undefined, false)).status, 401);
  assert.equal((await api("GET", "/ssh/hosts", undefined, false)).status, 401);
});

test("a cookie with extra parts and a wrong cookie are told apart", async () => {
  const res = await fetch(m.base + "/ssh/hosts", { headers: { cookie: `other=1; ${cookie}; x=y` } });
  assert.equal(res.status, 200);
  const bad = await fetch(m.base + "/ssh/hosts", { headers: { cookie: "nexo_ssh=forged" } });
  assert.equal(bad.status, 401);
});

test("hosts are validated field by field", async () => {
  const bad = async (patch: Record<string, unknown>, re: RegExp) => {
    const r = await api("POST", "/ssh/hosts", { ...goodHost, ...patch });
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.match(r.body.error, re);
  };
  await bad({ name: "" }, /name must have/);
  await bad({ name: "x".repeat(61) }, /name must have/);
  await bad({ name: 5 }, /name must have/);
  await bad({ host: "bad host!" }, /Invalid host/);
  await bad({ host: "-oProxyCommand=x" }, /Invalid host/);
  await bad({ host: 5 }, /Invalid host/);
  await bad({ port: 0 }, /Invalid port/);
  await bad({ port: 70000 }, /Invalid port/);
  await bad({ port: "22" }, /Invalid port/);
  await bad({ user: "a b" }, /Invalid user/);
  await bad({ user: "-x" }, /Invalid user/);
  await bad({ auth: "kerberos" }, /Invalid access type/);
  await bad({ project: "ghost" }, /Unknown project/);
  await bad({ project: 7 }, /Unknown project/);
  await bad({ secret: 5 }, /Invalid secret/);
  await bad({ passphrase: "x".repeat(20_001) }, /Invalid passphrase/);
  assert.equal((await api("POST", "/ssh/hosts", [])).status, 400);
});

let hostId = "";
test("hosts are added, updated and removed without ever returning the secret", async () => {
  const added = await api("POST", "/ssh/hosts", { ...goodHost, project: "shop", name: "  web  " });
  assert.equal(added.status, 200);
  assert.equal(added.body.name, "web");
  assert.equal(added.body.hasSecret, true);
  assert.equal(added.body.project, "shop");
  assert.ok(!JSON.stringify(added.body).includes('"pw"'));
  hostId = added.body.id;
  const updated = await api("PUT", `/ssh/hosts/${hostId}`, { ...goodHost, name: "web 2", secret: undefined, project: undefined });
  assert.equal(updated.body.name, "web 2");
  assert.equal(updated.body.hasSecret, true, "an omitted secret is kept");
  assert.equal(updated.body.project, null);
  assert.equal((await api("PUT", "/ssh/hosts/nope", goodHost)).status, 404);
  const extra = (await api("POST", "/ssh/hosts", { ...goodHost, name: "tmp", auth: "local", secret: undefined })).body;
  assert.deepEqual((await api("DELETE", `/ssh/hosts/${extra.id}`)).body, { ok: true });
  assert.equal((await api("DELETE", `/ssh/hosts/${extra.id}`)).status, 404);
  assert.equal((await api("GET", "/ssh/hosts")).body.length, 1);
});

test("opening a host creates a bound tab in its project and a console that is not shared yet", async () => {
  await api("PUT", `/ssh/hosts/${hostId}`, { ...goodHost, name: "web 2", project: "shop" });
  assert.equal((await api("POST", "/ssh/hosts/nope/open")).status, 404);
  const r = await api("POST", `/ssh/hosts/${hostId}/open`);
  assert.equal(r.status, 200);
  const tab = listTabs().find((t) => t.id === r.body.tabId)!;
  assert.equal(tab.project, "shop");
  assert.equal(tab.cwd, join(shop, "code"));
  assert.equal(tab.title, "ssh · web 2");
  assert.deepEqual(tab.meta.ssh, { hostId, hostName: "web 2" });
  const s = await api("GET", `/ssh/sessions/${r.body.tabId}`);
  assert.equal(s.body.state, "connecting");
  assert.equal(s.body.shared, false);
  ptys.at(-1)!.emit(CONNECTED + "$ ");
  assert.equal((await api("GET", `/ssh/sessions/${r.body.tabId}`)).body.state, "connected");
  kill(r.body.tabId);
  closeTab(r.body.tabId);
});

test("a host without a project opens in the home folder; a failed launch leaves no tab behind", async () => {
  await api("PUT", `/ssh/hosts/${hostId}`, { ...goodHost, name: "web 2" });
  const before = listTabs().length;
  const r = await api("POST", `/ssh/hosts/${hostId}/open`);
  assert.equal(r.status, 200);
  assert.equal(listTabs().find((t) => t.id === r.body.tabId)!.project, "");
  kill(r.body.tabId);
  closeTab(r.body.tabId);
  launchFails = true;
  const failed = await api("POST", `/ssh/hosts/${hostId}/open`);
  launchFails = false;
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /Could not open/);
  assert.equal(listTabs().length, before);
});

test("sessions: a bound tab without a live console reads as closed, connect reopens it, share toggles it", async () => {
  assert.equal((await api("GET", "/ssh/sessions/ghost")).status, 404);
  const tab = openTab({ project: "", dir: env.root, cwd: env.root, title: "ssh", meta: { ssh: { hostId, hostName: "web 2" } } });
  const closed = await api("GET", `/ssh/sessions/${tab}`);
  assert.deepEqual(closed.body, { tabId: tab, hostId, hostName: "web 2", state: "closed", shared: false, busy: false });
  assert.equal((await api("POST", `/ssh/sessions/${tab}/share`, { shared: true })).status, 404);
  const conn = await api("POST", `/ssh/sessions/${tab}/connect`);
  assert.equal(conn.status, 200);
  assert.equal(conn.body.state, "connecting");
  assert.equal((await api("POST", `/ssh/sessions/${tab}/share`, {})).status, 400);
  assert.equal((await api("POST", `/ssh/sessions/${tab}/share`, { shared: "yes" })).status, 400);
  const shared = await api("POST", `/ssh/sessions/${tab}/share`, { shared: true });
  assert.equal(shared.body.shared, true);
  assert.equal(status(tab)!.shared, true);
  kill(tab);
  closeTab(tab);
});

test("connect fails for a tab with no SSH binding or whose saved access was deleted", async () => {
  const plain = openTab({ project: "", dir: env.root, cwd: env.root, title: "plain" });
  assert.equal((await api("POST", `/ssh/sessions/${plain}/connect`)).status, 404);
  assert.equal((await api("GET", `/ssh/sessions/${plain}`)).status, 404);
  const gone = openTab({ project: "", dir: env.root, cwd: env.root, title: "gone", meta: { ssh: { hostId: "deleted", hostName: "x" } } });
  const r = await api("POST", `/ssh/sessions/${gone}/connect`);
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no longer exists/);
  closeTab(plain);
  closeTab(gone);
});

test("a plan waiting for the user is approved or rejected through the route, once", async () => {
  const tab = openTab({ project: "", dir: env.root, cwd: env.root, title: "plan", meta: { ssh: { hostId, hostName: "web 2" } } });
  await api("POST", `/ssh/sessions/${tab}/connect`);
  ptys.at(-1)!.emit(CONNECTED + "$ ");
  setShared(tab, true);
  const events: Ev[] = [];
  const h = sshHandlers(tab, (ev) => events.push(ev), new AbortController().signal);
  const waiting = h.plan({ summary: "restart", steps: [{ command: "systemctl restart nginx", why: "x" }] });
  const id = (events[0] as Extract<Ev, { kind: "module" }>).id;
  assert.equal((await api("POST", `/ssh/plans/${id}`, {})).status, 400);
  assert.equal((await api("POST", "/ssh/plans/unknown", { approve: true })).status, 404);
  assert.deepEqual((await api("POST", `/ssh/plans/${id}`, { approve: false })).body, { ok: true });
  assert.match((await waiting).content[0]!.text, /rejected/);
  assert.equal((await api("POST", `/ssh/plans/${id}`, { approve: true })).status, 404, "already decided");
  kill(tab);
  closeTab(tab);
});

test("lock closes the vault and clears the cookie; unlock needs the right password", async () => {
  const locked = await api("POST", "/ssh/lock", {});
  assert.deepEqual(locked.body, { state: "locked" });
  assert.match(locked.headers.get("set-cookie")!, /^nexo_ssh=; Max-Age=0;/);
  assert.equal((await api("GET", "/ssh/hosts")).status, 401, "the old cookie no longer works");
  assert.deepEqual((await api("GET", "/ssh/state", undefined, false)).body, { state: "locked" });
  assert.equal((await api("POST", "/ssh/unlock", {}, false)).status, 400);
  assert.equal((await api("POST", "/ssh/unlock", { password: "not the password!" }, false)).status, 401);
  const back = await api("POST", "/ssh/unlock", { password: PASSWORD }, false);
  assert.deepEqual(back.body, { state: "unlocked" });
  cookie = back.headers.get("set-cookie")!.split(";")[0]!;
  assert.equal((await api("GET", "/ssh/hosts")).body.length, 1, "the saved access survived");
});

test("sessions get the credential guard, the console tools and the note only on bound tabs", async () => {
  const ssh = contributions().find((c) => c.hooks)!;
  const bound = { id: "tb", title: "", project: "", dir: "", cwd: "", worktree: null, meta: { ssh: { hostId: "h", hostName: "prod-db" } } };
  const plain = { ...bound, id: "tp", meta: {} };
  const malformed = { ...bound, meta: { ssh: { hostId: 5 } } };
  assert.match(ssh.promptNote!(bound) ?? "", /SSH console to "prod-db"/);
  assert.equal(ssh.promptNote!(plain), null);
  assert.equal(ssh.promptNote!(malformed), null);
  const io = { emit: () => {}, signal: new AbortController().signal };
  const server = ssh.mcpServers!(bound, io) as Record<string, { type: string; name: string }>;
  assert.equal(server.ssh!.type, "sdk");
  assert.equal(server.ssh!.name, "ssh");
  assert.equal(ssh.mcpServers!(plain, io), null);
  assert.equal(ssh.autoAllow!(bound, "mcp__ssh__ssh_run"), true);
  assert.equal(ssh.autoAllow!(bound, "Bash"), false);
  assert.equal(ssh.autoAllow!(plain, "mcp__ssh__ssh_run"), false);
  // closing a tab ends its console
  const tab = openTab({ project: "", dir: env.root, cwd: env.root, title: "c", meta: { ssh: { hostId, hostName: "web 2" } } });
  await api("POST", `/ssh/sessions/${tab}/connect`);
  const pty = ptys.at(-1)!;
  ssh.onTurnEnd!({ ...bound, id: tab }, { prompt: "", skills: [], cost: 0, turns: 1, ok: true });
  ssh.onClose!({ ...bound, id: tab });
  assert.equal(pty.killed, true);
  assert.equal(status(tab), null);
  closeTab(tab);
});

test("the guard hook denies credential reads in every tab, and only for PreToolUse", async () => {
  const hook = contributions().find((c) => c.hooks)!.hooks!.PreToolUse![0]!.hooks[0]!;
  const signal = new AbortController().signal;
  const denied = (await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(env.root, "os", "data", "ssh", "vault", "vault.json") } } as never, undefined, { signal })) as any;
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(denied.hookSpecificOutput.permissionDecisionReason);
  const allowed = await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(env.root, "README.md") } } as never, undefined, { signal });
  assert.deepEqual(allowed, {});
  assert.deepEqual(await hook({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {} } as never, undefined, { signal }), {});
});
