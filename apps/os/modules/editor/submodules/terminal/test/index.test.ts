// The terminal routes through real HTTP, with a fake pty.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IPty } from "@lydell/node-pty";
import { mountModule, tempEnv } from "../../../../../host/test/harness.ts";
import { initProjects } from "../../../../projects/server/projects.ts";
import { closeTab, openTab, restoreTabs } from "../../../../sessions/server/agent.ts";
import register from "../server/index.ts";
import { addShellProvider, setPtySpawn } from "../server/terminal.ts";

const spawned: Array<{ file: string; args: string[]; cwd?: string; written: string[]; killed: boolean }> = [];
setPtySpawn(((file: string, args: string[], opts: { cwd?: string }) => {
  const rec = { file, args, cwd: opts.cwd, written: [] as string[], killed: false };
  spawned.push(rec);
  return { onData() {}, onExit() {}, write: (d: string) => rec.written.push(d), resize() {}, kill: () => (rec.killed = true) } as unknown as IPty;
}) as never);
after(() => setPtySpawn());

const env = tempEnv();
initProjects(env);
const dir = join(env.projects, "demo");
mkdirSync(join(dir, "code"), { recursive: true });
writeFileSync(join(dir, "AGENTS.md"), "# demo\n");
restoreTabs(join(env.state, "tabs.json"));
const tab = openTab({ project: "demo", dir, cwd: join(dir, "code"), title: "demo" });
const m = await mountModule(register, { env });
const t = `/tabs/${tab}`;

test("POST /terms creates a terminal with a default title; GET lists it", async () => {
  const created = await m.call("POST", `${t}/terms`, {});
  assert.equal(created.status, 200);
  assert.equal(created.body.title, "bash");
  assert.equal(spawned[0].cwd, join(dir, "code"));
  assert.deepEqual((await m.get(`${t}/terms`)).body.map((x: { id: string }) => x.id), [created.body.id]);
});

test("a run command titles the terminal and is typed into it", async () => {
  const r = await m.call("POST", `${t}/terms`, { run: "npm test" });
  assert.equal(r.body.title, "▶ npm test");
  assert.deepEqual(spawned[1].written, ["npm test\r"]);
  const named = await m.call("POST", `${t}/terms`, { title: "x".repeat(100) });
  assert.equal(named.body.title.length, 60);
});

test("a container terminal needs a provider (409), then uses the provider's shell", async () => {
  const no = await m.call("POST", `${t}/terms`, { where: "container" });
  assert.equal(no.status, 409);
  addShellProvider((_p, where) => (where === "container" ? { file: "devc", args: ["sh"] } : undefined));
  const yes = await m.call("POST", `${t}/terms`, { where: "container" });
  assert.equal(yes.body.title, "container");
  assert.equal(spawned.at(-1)!.file, "devc");
});

test("input writes into a live terminal, an unknown one is a 404, DELETE kills it", async () => {
  const { body: { id } } = await m.call("POST", `${t}/terms`, {});
  const rec = spawned.at(-1)!;
  assert.deepEqual((await m.call("POST", `${t}/terms/${id}/input`, { data: "ls\r" })).body, { ok: true });
  assert.deepEqual(rec.written, ["ls\r"]);
  assert.equal((await m.call("POST", `${t}/terms/ghost/input`, {})).status, 404);
  assert.deepEqual((await m.call("DELETE", `${t}/terms/${id}`)).body, { ok: true });
  assert.equal(rec.killed, true);
  assert.equal((await m.call("POST", `${t}/terms/${id}/input`, { data: "x" })).status, 404);
});

test("closing the tab kills its terminals", async () => {
  assert.ok(spawned.some((s) => !s.killed), "some terminals are still open");
  closeTab(tab);
  assert.ok(spawned.every((s) => s.killed));
  assert.equal((await m.get(`${t}/terms`)).status, 404);
});
