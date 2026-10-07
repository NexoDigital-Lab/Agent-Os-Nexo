// docker.ts with a fake process launcher: argv built per call, errors mapped to statuses, no real docker.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as docker from "../server/docker.ts";

type Reply = { stdout?: string; stderr?: string; err?: Partial<Error & { killed: boolean; code: string }> };
let calls: { file: string; args: string[]; timeout: number }[] = [];
let reply: (args: string[]) => Reply = () => ({ stdout: "" });
let spawnCalls: string[] = [];
const realSpawnDesktop = docker.dockerSys.spawnDesktop;

beforeEach(() => {
  calls = [];
  reply = () => ({ stdout: "" });
  spawnCalls = [];
  docker.dockerSys.platform = process.platform;
  docker.dockerSys.desktop = null;
  docker.dockerSys.exists = () => true;
  docker.dockerSys.spawnDesktop = (exe) => {
    spawnCalls.push(exe);
  };
  docker.dockerExec.execFile = ((file: string, args: string[], opts: { timeout: number }, cb: (e: unknown, o: string, s: string) => void) => {
    calls.push({ file, args, timeout: opts.timeout });
    const r = reply(args);
    setImmediate(() => cb(r.err ? Object.assign(new Error("failed"), r.err) : null, r.stdout ?? "", r.stderr ?? ""));
  }) as unknown as typeof docker.dockerExec.execFile;
});

const fails = async (p: Promise<unknown>) => p.then(() => assert.fail("should reject"), (e: Error & { status: number }) => e);

test("dockerRun resolves stdout and passes argv and timeout", async () => {
  reply = () => ({ stdout: "hello" });
  assert.equal(await docker.dockerRun(["version"], 123), "hello");
  assert.deepEqual(calls[0], { file: "docker", args: ["version"], timeout: 123 });
  await docker.dockerRun(["ps"]);
  assert.equal(calls[1]!.timeout, 30_000);
});

test("dockerRun maps a timeout, a dead daemon, a missing binary and plain failures", async () => {
  reply = () => ({ err: { killed: true } });
  let e = await fails(docker.dockerRun(["ps"], 5000));
  assert.equal(e.status, 504);
  assert.match(e.message, /5 s/);
  reply = () => ({ err: {}, stderr: "Cannot connect to the Docker daemon at unix:///x" });
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  docker.dockerSys.platform = "win32";
  reply = () => ({ err: { code: "ENOENT", message: "spawn docker ENOENT" } });
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  assert.equal(e.message, "The Docker CLI was not found.");
  reply = () => ({ err: {}, stderr: "first line\nError: no such image\n" });
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 400);
  assert.equal(e.message, "Error: no such image");
  reply = () => ({ err: { message: "spawn failed" }, stderr: "" });
  assert.equal((await fails(docker.dockerRun(["ps"]))).message, "spawn failed", "falls back to the error message");
  reply = () => ({ err: { message: "" }, stderr: "  \n" });
  assert.equal((await fails(docker.dockerRun(["ps"]))).message, "docker failed", "never an empty message");
});

test("dockerRun maps Windows daemon-down to the CLI-first message, and a missing CLI to a short message", async () => {
  docker.dockerSys.platform = "win32";
  docker.dockerSys.desktop = "C:\\Docker\\Docker Desktop.exe";
  reply = () => ({
    err: {},
    stderr: "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: El sistema no puede encontrar el archivo especificado.",
  });
  let e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  assert.match(e.message, /Docker is not running/);
  assert.match(e.message, /The Docker CLI is installed/);
  docker.dockerSys.desktop = null;
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  assert.match(e.message, /Docker is not running/);
  assert.match(e.message, /The Docker CLI is installed/, "one message now, with or without Desktop");
  reply = () => ({ err: { code: "ENOENT", message: "spawn docker ENOENT" } });
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  assert.equal(e.message, "The Docker CLI was not found.");
});

test("dockerRun maps a dead daemon and a missing CLI on other platforms to the original messages", async () => {
  docker.dockerSys.platform = "linux";
  reply = () => ({ err: {}, stderr: "Cannot connect to the Docker daemon at unix:///x" });
  let e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  assert.equal(e.message, "Docker is not running (open Docker Desktop or start the daemon)");
  reply = () => ({ err: { code: "ENOENT", message: "spawn docker ENOENT" } });
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  assert.equal(e.message, "The Docker CLI was not found.");
});

/** Fake replies for info(): --version, the server-version probe, and context show. */
const cliLine = "Docker version 27.1, build abc";
const infoReply = (opts: { cli?: Reply; server?: Reply } = {}) => (a: string[]) => {
  if (a[0] === "--version") return opts.cli ?? { stdout: `${cliLine}\n` };
  if (a[0] === "version") return opts.server ?? { stdout: "27.1\n" };
  return { stdout: "desktop-linux\n" };
};

test("info reports the CLI line, server version and context when everything answers", async () => {
  reply = infoReply();
  assert.deepEqual(await docker.info(), {
    ok: true,
    cli: { found: true, version: cliLine },
    version: "27.1",
    context: "desktop-linux",
  });
});

test("info reports the CLI even when the daemon is down", async () => {
  reply = infoReply({ server: { err: {}, stderr: "error during connect" } });
  const r = await docker.info();
  assert.equal(r.ok, false);
  assert.deepEqual(r.cli, { found: true, version: cliLine }, "the CLI probe answers without the daemon");
  assert.match(String(r.error), /not running/, "every platform's daemon-down message starts there");
});

test("the daemon-down message is CLI-first on Windows", async () => {
  docker.dockerSys.platform = "win32";
  reply = infoReply({ server: { err: {}, stderr: "error during connect" } });
  const r = await docker.info();
  assert.match(String(r.error), /CLI/);
  assert.match(String(r.error), /not running/);
});

test("info offers to open Docker Desktop when the daemon is down but Desktop is installed", async () => {
  docker.dockerSys.desktop = "C:\\Docker\\Docker Desktop.exe";
  reply = infoReply({ server: { err: {}, stderr: "Cannot connect to the Docker daemon at unix:///x" } });
  const r = await docker.info();
  assert.equal(r.ok, false);
  assert.equal(r.cli.found, true);
  assert.equal(r.action, "open-desktop");
  assert.match(String(r.error), /not running/);
  assert.equal(r.installHint, undefined);
});

test("info offers no action when the daemon is down and Desktop is not installed", async () => {
  docker.dockerSys.desktop = null;
  reply = infoReply({ server: { err: {}, stderr: "Cannot connect to the Docker daemon at unix:///x" } });
  const r = await docker.info();
  assert.equal(r.ok, false);
  assert.equal(r.cli.found, true);
  assert.equal(r.action, null);
});

test("info hints winget when the CLI is missing on Windows", async () => {
  docker.dockerSys.platform = "win32";
  reply = () => ({ err: { code: "ENOENT", message: "spawn docker ENOENT" } });
  const r = await docker.info();
  assert.equal(r.ok, false);
  assert.deepEqual(r.cli, { found: false, version: null });
  assert.equal(r.action, "install-cli");
  assert.equal(r.installHint, "winget install Docker.DockerDesktop");
  assert.equal(r.error, "The Docker CLI was not found.");
});

test("info hints the docs URL when the CLI is missing on Linux", async () => {
  docker.dockerSys.platform = "linux";
  reply = () => ({ err: { code: "ENOENT", message: "spawn docker ENOENT" } });
  const r = await docker.info();
  assert.equal(r.ok, false);
  assert.deepEqual(r.cli, { found: false, version: null });
  assert.equal(r.action, "install-cli");
  assert.equal(r.installHint, "https://docs.docker.com/get-docker/");
});

test("openDockerDesktop refuses without an installed Desktop, else launches it", () => {
  docker.dockerSys.desktop = null;
  assert.throws(() => docker.openDockerDesktop(), (e: Error & { status: number }) => e.status === 400 && /not installed/.test(e.message));
  docker.dockerSys.desktop = "C:\\Docker\\Docker Desktop.exe";
  assert.deepEqual(docker.openDockerDesktop(), { ok: true, path: "C:\\Docker\\Docker Desktop.exe" });
  assert.deepEqual(spawnCalls, ["C:\\Docker\\Docker Desktop.exe"], "goes through the injectable launcher, never a real spawn");
});

test("openDockerDesktop refuses a Desktop uninstalled since the server started", () => {
  docker.dockerSys.desktop = "C:\\Docker\\Docker Desktop.exe";
  docker.dockerSys.exists = () => false;
  assert.throws(() => docker.openDockerDesktop(), (e: Error & { status: number }) => e.status === 400 && /no longer installed/.test(e.message));
  assert.deepEqual(spawnCalls, [], "nothing is launched");
});

test("the real Desktop launcher survives an exe that cannot start (no unhandled 'error')", async () => {
  realSpawnDesktop("/nonexistent/Docker Desktop.exe");
  // spawn reports ENOENT on a later tick; without a listener that would crash the whole server (and this test run).
  await new Promise((r) => setTimeout(r, 200));
});

test("containers parses the json lines and the project label", async () => {
  const row = (o: object) => JSON.stringify({ ID: "a".repeat(64), Names: "n", Image: "i", State: "running", Status: "Up", Ports: "", CreatedAt: "now", Labels: "", ...o });
  reply = () => ({ stdout: `${row({ Labels: "x=1,agent-os-nexo.project=crm-ws/api,y=2" })}\n\n${row({ Names: "plain" })}\n` });
  const list = await docker.containers();
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, "a".repeat(12));
  assert.equal(list[0]!.project, "crm-ws/api");
  assert.equal(list[1]!.project, null);
  assert.deepEqual(calls[0]!.args.slice(0, 3), ["ps", "-a", "--no-trunc"]);
});

test("images marks the ones a container uses", async () => {
  const img = (id: string) => JSON.stringify({ ID: id, Repository: "r", Tag: "t", Size: "1MB", CreatedSince: "1d" });
  reply = (a) => {
    if (a[0] === "images") return { stdout: `${img("sha256:" + "b".repeat(20))}\n${img("c".repeat(12))}\n` };
    if (a[0] === "ps") return { stdout: "c1\nc2\n" };
    return { stdout: `sha256:${"b".repeat(20)}\n` };
  };
  const list = await docker.images();
  assert.deepEqual(list.map((i) => [i.id, i.inUse]), [["b".repeat(12), true], ["c".repeat(12), false]]);
  assert.deepEqual(calls.find((c) => c.args[0] === "inspect")!.args.slice(-2), ["c1", "c2"]);
});

test("images with no containers skips inspect, and survives a failing usage lookup", async () => {
  const img = JSON.stringify({ ID: "d".repeat(12), Repository: "r", Tag: "t", Size: "1", CreatedSince: "1d" });
  reply = (a) => ({ stdout: a[0] === "images" ? img : "" });
  assert.equal((await docker.images())[0]!.inUse, false);
  assert.ok(!calls.some((c) => c.args[0] === "inspect"));
  reply = (a) => (a[0] === "images" ? { stdout: img } : { err: {}, stderr: "boom" });
  assert.equal((await docker.images()).length, 1);
});

test("references that could be options or shell tricks are refused before docker runs", async () => {
  for (const bad of ["-f", "a b", "", "a;rm"]) {
    assert.equal((await fails(docker.containerAction(bad, "rm"))).status, 400);
    assert.throws(() => docker.execShellArgs(bad), /Invalid reference/);
  }
  assert.throws(() => docker.pull("--all"), /Invalid reference/); // refused synchronously, before any promise
  assert.equal(calls.length, 0);
});

test("container actions build the right argv", async () => {
  await docker.containerAction("web", "rm");
  await docker.containerAction("web", "restart");
  assert.deepEqual(calls.map((c) => c.args), [["rm", "-f", "web"], ["restart", "web"]]);
  assert.equal(calls[0]!.timeout, 60_000);
});

test("logs, removeImage and pull", async () => {
  reply = () => ({ stdout: "line\n" });
  assert.equal(await docker.logs("web", 5), "line\n");
  assert.deepEqual(calls[0]!.args, ["logs", "--tail", "5", "--timestamps", "web"]);
  assert.equal(await docker.removeImage("img:1"), undefined);
  assert.equal(await docker.pull("python:3.12"), "line");
  assert.equal(calls[2]!.timeout, 15 * 60_000);
  reply = () => ({ err: {}, stderr: "no such container" });
  assert.equal(await docker.logs("gone"), "(no such container)");
});

test("projectLabel returns the label, or null when empty or failing", async () => {
  reply = () => ({ stdout: " crm \n" });
  assert.equal(await docker.projectLabel("c"), "crm");
  reply = () => ({ stdout: "\n" });
  assert.equal(await docker.projectLabel("c"), null);
  reply = () => ({ err: {}, stderr: "x" });
  assert.equal(await docker.projectLabel("c"), null);
});

test("execShellArgs adds the working dir only when given", () => {
  assert.deepEqual(docker.execShellArgs("c").slice(0, 3), ["exec", "-it", "c"]);
  assert.deepEqual(docker.execShellArgs("c", "/w").slice(0, 5), ["exec", "-it", "-w", "/w", "c"]);
});
