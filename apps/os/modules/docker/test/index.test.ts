// The docker module's routes over real HTTP with a fake docker launcher, and the hooks it registers in other modules.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule } from "../../../host/test/harness.ts";
import { projectHooks } from "../../projects/server/hooks.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { contributions } from "../../sessions/server/contributions.ts";
import { openTab, restoreTabs } from "../../sessions/server/agent.ts";
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
  docker.dockerSys.desktop = null;
  docker.dockerExec.execFile = ((_f: string, args: string[], _o: unknown, cb: (e: unknown, o: string, s: string) => void) => {
    calls.push(args);
    const r = reply(args);
    setImmediate(() => cb(r.err ? new Error("x") : null, r.stdout ?? "", r.stderr ?? ""));
  }) as unknown as typeof docker.dockerExec.execFile;
});

const hooksBefore = projectHooks().length;
const contribBefore = contributions().length;
const m = await mountModule(register, { id: "docker" });
initProjects(m.ctx.env);
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
  reply = (a) => {
    if (a[0] === "--version") return { stdout: "Docker version 27, build abc\n" };
    if (a[0] === "version") return { stdout: "27\n" };
    return { stdout: "ctx\n" };
  };
  assert.deepEqual((await m.get("/docker/info")).body, {
    ok: true,
    cli: { found: true, version: "Docker version 27, build abc" },
    version: "27",
    context: "ctx",
  });
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

test("info failure carries the action, and opening the Desktop without one is a 400", async () => {
  // CLI present (--version ok), daemon down: the softer signal keeps the CLI visible.
  reply = (a) => {
    if (a[0] === "--version") return { stdout: "Docker version 27, build abc\n" };
    return { err: true, stderr: "Cannot connect to the Docker daemon" };
  };
  const r = await m.get("/docker/info");
  assert.equal(r.body.ok, false);
  assert.equal(r.body.cli.found, true);
  assert.match(r.body.error, /Docker is not running/);
  assert.equal(r.body.action, null, "no Desktop installed: nothing to open");
  const open = await m.call("POST", "/docker/desktop/open");
  assert.equal(open.status, 400);
  assert.match(open.body.error, /not installed/);
});

test("container actions: unknown action 400, bad id 400, rm forgets the project's shims", async () => {
  assert.equal((await m.call("POST", "/docker/containers/web/explode")).status, 400);
  assert.equal((await m.call("POST", "/docker/containers/-f/start")).status, 400);
  assert.deepEqual((await m.call("POST", "/docker/containers/web/restart")).body, { ok: true });
  assert.deepEqual(calls.at(-1), ["restart", "web"]);

  const shopRepo = join(m.ctx.env.projects, "shop", "code");
  mkdirSync(shopRepo, { recursive: true });
  writeFileSync(join(m.ctx.env.projects, "shop", "AGENTS.md"), "");
  fakeDevEnv("shop");
  // Another environment's container for a project of the same name: removed, but this environment's shims stay.
  reply = (a) => ({ stdout: a[0] === "inspect" ? "shop|/other/env/projects/shop/code\n" : "" });
  assert.equal((await m.call("POST", "/docker/containers/agentos-shop-abc123/rm")).status, 200);
  assert.deepEqual(calls.at(-1), ["rm", "-f", "agentos-shop-abc123"]);
  assert.equal(devenv.hasDevEnv("shop"), true);
  reply = (a) => ({ stdout: a[0] === "inspect" ? `shop|${shopRepo}\n` : "" });
  assert.equal((await m.call("POST", "/docker/containers/agentos-shop/rm")).status, 200);
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
  const name = devenv.containerName("gone");
  reply = () => ({ stdout: "true\n" });
  assert.deepEqual(await hooks.deleteFacts!(project), { container: name });
  reply = () => ({ err: true, stderr: "No such object: x" });
  assert.deepEqual(await hooks.deleteFacts!(project), { container: null });
  reply = () => ({ err: true, stderr: "Cannot connect to the Docker daemon" });
  assert.deepEqual(await hooks.deleteFacts!(project), { container: null }, "unknown state is not offered");
  assert.deepEqual(await hooks.deleteFacts!({ id: "nopath", path: null } as never), { container: null });

  const steps: string[] = [];
  reply = (a) => ({ stdout: a[0] === "inspect" ? "/x/code\n" : "" });
  await hooks.afterLocalDelete!(project, { container: false } as never, steps);
  assert.deepEqual(steps, []);
  await hooks.afterLocalDelete!({ id: "gone", path: null } as never, { container: true } as never, steps);
  assert.deepEqual(steps, [], "no repo, nothing to match the container against");
  await hooks.afterLocalDelete!(project, { container: true } as never, steps);
  assert.deepEqual(steps, [`Container ${name} and its shims removed`]);
  reply = () => ({ err: true, stderr: "daemon exploded" });
  await hooks.afterLocalDelete!(project, { container: true } as never, steps);
  assert.match(steps[1]!, /not removed: daemon exploded/);
  assert.ok(!existsSync(devenv.shimDir("gone")));
});

test("the tab's stack: detection with a proposal, profiles saved in context/, status, actions and logs", async () => {
  const dir = join(m.ctx.env.projects, "stack");
  const repo = join(dir, "code");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(dir, "context"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "");
  writeFileSync(join(repo, "docker-compose.yml"), "");
  writeFileSync(join(repo, "docker-compose.prod.yml"), "");
  restoreTabs(join(m.ctx.env.state, "tabs.json"));
  const t = `/tabs/${openTab({ project: "stack", dir, cwd: repo, title: "stack" })}/stack`;
  const config = { name: "stack", services: { db: { image: "postgres:16", environment: { POSTGRES_PASSWORD: "hunter2" } } } };
  reply = (a) => {
    if (a[1] === "ls") return { stdout: JSON.stringify([{ Name: "stack", Status: "running(1)", ConfigFiles: join(repo, "docker-compose.yml") }]) };
    if (a[0] === "context") return { stdout: "unix:///var/run/docker.sock\n" };
    if (a[0] === "ps") return { stdout: "" }; // nobody else owns the compose project
    if (a.includes("config")) return { stdout: JSON.stringify(config) };
    if (a.includes("ps")) return { stdout: JSON.stringify({ Service: "db", Name: "stack-db-1", State: "running", Health: "", ExitCode: 0 }) };
    if (a.includes("logs")) return { stdout: "db | ready\n" };
    return { stdout: "" };
  };

  const first = await m.get(t);
  assert.equal(first.status, 200);
  assert.ok(!JSON.stringify(first.body).includes("hunter2"), "no environment value reaches the browser");
  assert.equal(first.body.config, null);
  assert.equal(first.body.proposed.default, "default");
  assert.deepEqual(first.body.prod, ["prod"]);
  assert.deepEqual(first.body.stacks, [{ name: "stack", status: "running(1)", files: ["docker-compose.yml"] }]);
  assert.equal(first.body.local, true);
  assert.equal((await m.get(`${t}/status`)).status, 409, "no profile saved yet");

  const saved = await m.call("PUT", `${t}/profiles`, first.body.proposed);
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "context", "docker.json"), "utf8")), saved.body);
  assert.equal((await m.get(t)).body.proposed, null);
  assert.equal((await m.call("PUT", `${t}/profiles`, { default: "x", profiles: {} })).status, 400);

  assert.equal((await m.get(`${t}/status`)).body.state, "running");
  assert.equal((await m.get(`${t}/status?profile=ghost`)).status, 404);
  assert.equal((await m.call("POST", `${t}/explode`, {})).status, 400);
  const prod = await m.call("POST", `${t}/up`, { profile: "prod" });
  assert.deepEqual([prod.status, prod.body.error], [409, "Confirm to continue: this profile looks like production."]);
  assert.deepEqual((await m.call("POST", `${t}/stop`, { profile: "prod", confirm: true })).body, { started: "stop" });
  assert.deepEqual((await m.call("POST", `${t}/restart`, {})).body, { started: "restart" });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.some((c) => c.join(" ").endsWith(`-f ${join(repo, "docker-compose.prod.yml")} stop`)));
  assert.deepEqual((await m.get(`${t}/logs?service=db`)).body, { text: "db | ready\n" });
  assert.equal((await m.get(`${t}/logs?service=-x`)).status, 400);
  assert.equal((await m.get("/tabs/ghost/stack")).status, 404);

  // docker.json edited by hand (or by an agent) is checked again before any use: no flags smuggled in as services.
  const hand = JSON.parse(readFileSync(join(dir, "context", "docker.json"), "utf8"));
  hand.profiles.default.services = ["--build"];
  writeFileSync(join(dir, "context", "docker.json"), JSON.stringify(hand));
  calls = [];
  const smuggled = await m.call("POST", `${t}/up`, {});
  assert.deepEqual([smuggled.status, smuggled.body.error], [400, "Invalid service name: --build"]);
  assert.equal((await m.get(`${t}/status`)).status, 400);
  assert.ok(!calls.some((c) => c.includes("--build")));
});
