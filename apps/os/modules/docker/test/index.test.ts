// The docker module's routes over real HTTP with a fake docker launcher, and the hooks it registers in other modules.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule } from "../../../host/test/harness.ts";
import { projectHooks } from "../../projects/server/hooks.ts";
import { contributions } from "../../sessions/server/contributions.ts";
import { shellFor } from "../../editor/submodules/terminal/server/terminal.ts";
import * as docker from "../server/docker.ts";
import * as devenv from "../server/devenv.ts";
import register from "../server/index.ts";

let calls: string[][] = [];
let reply: (args: string[]) => { stdout?: string; stderr?: string; err?: boolean } = () => ({});
beforeEach(() => {
  calls = [];
  reply = () => ({ stdout: "" });
  docker.dockerSys.platform = process.platform;
  docker.dockerExec.execFile = ((_f: string, args: string[], _o: unknown, cb: (e: unknown, o: string, s: string) => void) => {
    calls.push(args);
    const r = reply(args);
    setImmediate(() => cb(r.err ? new Error("x") : null, r.stdout ?? "", r.stderr ?? ""));
  }) as unknown as typeof docker.dockerExec.execFile;
});

const hooksBefore = projectHooks().length;
const contribBefore = contributions().length;
const m = await mountModule(register, { id: "docker" });
const hooks = projectHooks()[hooksBefore]!;
const contrib = contributions()[contribBefore]!;

/** Pretends a dev container was created for `project`, without docker. */
function fakeDevEnv(project: string) {
  const dir = devenv.shimDir(project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(devenv.envFile(project), "");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ lang: "node", version: "22", ports: [3000], image: "node:22-bookworm" }));
}

test("info and listings go through the docker CLI", async () => {
  reply = (a) => ({ stdout: a[0] === "version" ? "27\n" : "ctx\n" });
  assert.deepEqual((await m.get("/docker/info")).body, { ok: true, version: "27", context: "ctx" });
  reply = () => ({ stdout: "" });
  assert.deepEqual((await m.get("/docker/containers")).body, []);
  assert.deepEqual((await m.get("/docker/images")).body, []);
});

test("a dead daemon is a 503 with a readable error", async () => {
  reply = () => ({ err: true, stderr: "Cannot connect to the Docker daemon" });
  const r = await m.get("/docker/containers");
  assert.equal(r.status, 503);
  assert.match(r.body.error, /Docker is not running/);
});

test("container actions: unknown action 400, bad id 400, rm forgets the project's shims", async () => {
  assert.equal((await m.call("POST", "/docker/containers/web/explode")).status, 400);
  assert.equal((await m.call("POST", "/docker/containers/-f/start")).status, 400);
  assert.deepEqual((await m.call("POST", "/docker/containers/web/restart")).body, { ok: true });
  assert.deepEqual(calls.at(-1), ["restart", "web"]);

  fakeDevEnv("shop");
  reply = (a) => ({ stdout: a[0] === "inspect" ? "shop\n" : "" });
  assert.equal((await m.call("POST", "/docker/containers/agentos-shop/rm")).status, 200);
  assert.deepEqual(calls.at(-1), ["rm", "-f", "agentos-shop"]);
  assert.equal(devenv.hasDevEnv("shop"), false);
});

test("logs, image removal and pull", async () => {
  reply = () => ({ stdout: "log line\n" });
  assert.deepEqual((await m.get("/docker/containers/web/logs")).body, { text: "log line\n" });
  assert.equal((await m.call("DELETE", "/docker/images/abc123")).status, 200);
  assert.deepEqual(calls.at(-1), ["rmi", "abc123"]);
  assert.deepEqual((await m.call("POST", "/docker/pull", { image: "alpine:3" })).body, { digest: "log line" });
  assert.equal((await m.call("POST", "/docker/pull", {})).status, 400);
});

test("docker terminals list starts empty; killing an unknown one is harmless", async () => {
  assert.deepEqual((await m.get("/docker/terms")).body, []);
  assert.deepEqual((await m.call("DELETE", "/docker/terms/nope")).body, { ok: true });
});

test("the tab's dev container routes need a known tab", async () => {
  for (const [method, path] of [["GET", ""], ["POST", ""], ["DELETE", ""], ["POST", "/install"]] as const) {
    const r = await m.call(method, `/tabs/ghost/devenv${path}`, method === "POST" ? {} : undefined);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.body.error, "Unknown tab");
  }
});

test("shell provider: host shell sources the shims' bashrc, container opens ctr, others get the default", () => {
  assert.equal(shellFor("plain", "host"), undefined);
  fakeDevEnv("webapp");
  const host = shellFor("webapp", "host")!;
  assert.equal(host.file, "bash");
  assert.deepEqual(host.args, ["--rcfile", join(devenv.shimDir("webapp"), "bashrc"), "-i"]);
  assert.deepEqual(shellFor("webapp", "container"), { file: join(devenv.shimDir("webapp"), "ctr"), args: [] });
  assert.throws(() => shellFor("plain", "container"), /no dev container/);
});

test("session contribution: env file and prompt note only for projects with a dev container", () => {
  fakeDevEnv("api");
  const tab = (project: string) => ({ project }) as never;
  assert.deepEqual(contrib.env!(tab("api")), { CLAUDE_ENV_FILE: devenv.envFile("api") });
  assert.equal(contrib.env!(tab("plain")), null);
  assert.equal(contrib.env!(tab("")), null);
  assert.match(contrib.promptNote!(tab("api")) as string, /agentos-api/);
  assert.equal(contrib.promptNote!(tab("")), null);
});

test("project delete hooks offer the container and remove it on request", async () => {
  const project = { id: "gone", path: "/x/code" } as never;
  reply = () => ({ stdout: "true\n" });
  assert.deepEqual(await hooks.deleteFacts!(project), { container: "agentos-gone" });
  reply = () => ({ err: true, stderr: "No such object: x" });
  assert.deepEqual(await hooks.deleteFacts!(project), { container: null });
  reply = () => ({ err: true, stderr: "Cannot connect to the Docker daemon" });
  assert.deepEqual(await hooks.deleteFacts!(project), { container: null }, "unknown state is not offered");
  assert.deepEqual(await hooks.deleteFacts!({ id: "nopath", path: null } as never), { container: null });

  const steps: string[] = [];
  reply = () => ({ stdout: "" });
  await hooks.afterLocalDelete!(project, { container: false } as never, steps);
  assert.deepEqual(steps, []);
  await hooks.afterLocalDelete!(project, { container: true } as never, steps);
  assert.deepEqual(steps, ["Container agentos-gone and its shims removed"]);
  reply = () => ({ err: true, stderr: "daemon exploded" });
  await hooks.afterLocalDelete!(project, { container: true } as never, steps);
  assert.match(steps[1]!, /not removed: daemon exploded/);
  assert.ok(!existsSync(devenv.shimDir("gone")));
});
