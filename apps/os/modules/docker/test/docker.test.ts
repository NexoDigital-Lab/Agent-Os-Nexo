// docker.ts with a fake process launcher: argv built per call, errors mapped to statuses, no real docker.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as docker from "../server/docker.ts";

type Reply = { stdout?: string; stderr?: string; err?: Partial<Error & { killed: boolean; code: string }> };
let calls: { file: string; args: string[]; timeout: number }[] = [];
let reply: (args: string[]) => Reply = () => ({ stdout: "" });

beforeEach(() => {
  calls = [];
  reply = () => ({ stdout: "" });
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
  reply = () => ({ err: { code: "ENOENT", message: "spawn docker ENOENT" } });
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 503);
  assert.match(e.message, /ENOENT/);
  reply = () => ({ err: {}, stderr: "first line\nError: no such image\n" });
  e = await fails(docker.dockerRun(["ps"]));
  assert.equal(e.status, 400);
  assert.equal(e.message, "Error: no such image");
  reply = () => ({ err: { message: "spawn failed" }, stderr: "" });
  assert.equal((await fails(docker.dockerRun(["ps"]))).message, "spawn failed", "falls back to the error message");
  reply = () => ({ err: { message: "" }, stderr: "  \n" });
  assert.equal((await fails(docker.dockerRun(["ps"]))).message, "docker failed", "never an empty message");
});

test("info reports version and context, or the error", async () => {
  reply = (a) => ({ stdout: a[0] === "version" ? "27.1\n" : "desktop-linux\n" });
  assert.deepEqual(await docker.info(), { ok: true, version: "27.1", context: "desktop-linux" });
  reply = () => ({ err: {}, stderr: "error during connect" });
  const r = await docker.info();
  assert.equal(r.ok, false);
  assert.match(String(r.error), /not running/);
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
