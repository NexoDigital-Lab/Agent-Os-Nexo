// devenv.ts: version detection from manifests, container create/remove argv, shims and config on disk.
// Docker is a fake launcher that records argv; git is real (worktree list).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../../host/server/http.ts";
import { tempDir } from "../../../host/test/harness.ts";
import * as docker from "../server/docker.ts";
import * as devenv from "../server/devenv.ts";

const base = realpathSync(tempDir("devenv-"));
const projects = join(base, "projects");
const shims = join(base, "shims");
mkdirSync(projects, { recursive: true });
devenv.initDevenv(projects, shims);

type Reply = { stdout?: string; stderr?: string; err?: boolean };
let calls: string[][] = [];
let reply: (args: string[]) => Reply = () => ({});
/** The repo label the owner lookup (inspect of agent-os-nexo.repo alone) sees: null = no such container, DOWN = no answer. */
const DOWN = "\0down";
let owner: Record<string, string | null> = {};
const isOwnerLookup = (a: string[]) => a[0] === "inspect" && a[2] === '{{index .Config.Labels "agent-os-nexo.repo"}}';
beforeEach(() => {
  calls = [];
  owner = {};
  reply = (a) => ({ stdout: a[0] === "inspect" ? "true\n" : "" });
  docker.dockerExec.execFile = ((_f: string, args: string[], _o: unknown, cb: (e: unknown, o: string, s: string) => void) => {
    calls.push(args);
    const label = isOwnerLookup(args) ? (owner[args[3]!] ?? null) : undefined;
    const r = label === undefined ? reply(args)
      : label === null ? { err: true, stderr: "Error: No such object: x" }
      : label === DOWN ? { err: true, stderr: "daemon exploded" }
      : { stdout: `${label}\n` };
    setImmediate(() => cb(r.err ? new Error("x") : null, r.stdout ?? "", r.stderr ?? ""));
  }) as unknown as typeof docker.dockerExec.execFile;
});

let n = 0;
function repo(files: Record<string, string> = {}, name = `p${n++}`) {
  const dir = join(projects, name, "code");
  mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  return { name, dir };
}
const fails = async (p: Promise<unknown>) => p.then(() => assert.fail("should reject"), (e: Error & { status: number }) => e);

// The dev environment mounts host folders at the same path inside a Linux container; Windows paths (C:\\...) are not
// translated yet, so these two only hold where host paths are POSIX.
const linuxPaths = process.platform === "win32" ? "host paths are mounted as-is into a Linux container" : false;

test("detect reads the most explicit pin first and normalizes versions", () => {
  const { dir } = repo({
    ".tool-versions": "nodejs 20.11.1\npython 3.11.4\ngolang 1.22.3\n",
    "package.json": JSON.stringify({ engines: { node: ">=18" } }),
    ".python-version": "3.9",
  });
  assert.deepEqual(devenv.detect(dir), [
    { lang: "node", version: "20", evidence: ".tool-versions" },
    { lang: "python", version: "3.11", evidence: ".tool-versions" },
    { lang: "go", version: "1.22", evidence: ".tool-versions" },
  ]);
});

test("detect covers each pin file and the unpinned manifests", () => {
  const py = devenv.detect(repo({ "pyproject.toml": 'requires-python = ">=3.10"' }).dir);
  assert.deepEqual(py, [{ lang: "python", version: "3.10", evidence: "pyproject.toml" }]);
  assert.equal(devenv.detect(repo({ "runtime.txt": "python-3.8.2" }).dir)[0]!.evidence, "runtime.txt");
  assert.equal(devenv.detect(repo({ ".nvmrc": "v18.2.0" }).dir)[0]!.version, "18");
  assert.equal(devenv.detect(repo({ ".node-version": "16" }).dir)[0]!.evidence, ".node-version");
  assert.deepEqual(devenv.detect(repo({ "package.json": '{"engines":{"node":"^20.1"}}' }).dir)[0], { lang: "node", version: "20", evidence: "package.json engines" });
  assert.equal(devenv.detect(repo({ "go.mod": "module x\n\ngo 1.21.5\n" }).dir)[0]!.version, "1.21");
  assert.equal(devenv.detect(repo({ "requirements.txt": "" }).dir)[0]!.version, "3.12");
  assert.equal(devenv.detect(repo({ "package.json": "{}" }).dir)[0]!.version, "22");
  assert.equal(devenv.detect(repo({ "go.mod": "module x\n" }).dir)[0]!.version, "1.23");
  assert.deepEqual(devenv.detect(repo({ "package.json": "{broken" }).dir).map((d) => d.evidence), ["package.json (no engines)"]);
  assert.deepEqual(devenv.detect(repo().dir), []);
});

test("names and paths: nested ids become --", () => {
  assert.match(devenv.containerName("crm-ws/api"), /^agentos-crm-ws--api-[0-9a-f]{6}$/, "the name carries this environment");
  assert.equal(devenv.shimDir("crm-ws/api"), join(shims, "crm-ws--api"));
  assert.equal(devenv.envFile("a"), join(shims, "a", "env.sh"));
  assert.equal(devenv.hasDevEnv("never-created"), false);
});

test("installCommand picks by lockfile", () => {
  const cmd = (files: Record<string, string>, lang: devenv.Lang) => devenv.installCommand(repo(files).dir, lang);
  assert.equal(cmd({ "requirements.txt": "" }, "python"), "pip install -r requirements.txt");
  assert.equal(cmd({ "pyproject.toml": "" }, "python"), "pip install -e .");
  assert.equal(cmd({}, "python"), null);
  assert.equal(cmd({ "pnpm-lock.yaml": "", "package.json": "{}" }, "node"), "corepack enable && pnpm install");
  assert.equal(cmd({ "yarn.lock": "" }, "node"), "corepack enable && yarn install");
  assert.equal(cmd({ "package.json": "{}" }, "node"), "npm install");
  assert.equal(cmd({}, "node"), null);
  assert.equal(cmd({ "go.mod": "" }, "go"), "go mod download");
  assert.equal(cmd({}, "go"), null);
  assert.equal(devenv.installCommand(repo().dir, "rust" as devenv.Lang), null);
});

test("create validates the input before touching docker", async () => {
  const { name, dir } = repo();
  assert.equal((await fails(devenv.create("bad name", dir, { lang: "node", version: "22", ports: [] }))).status, 400);
  assert.equal((await fails(devenv.create("..", dir, { lang: "node", version: "22", ports: [] }))).status, 400);
  assert.match((await fails(devenv.create(name, dir, { lang: "ruby" as devenv.Lang, version: "3", ports: [] }))).message, /Unsupported language/);
  assert.match((await fails(devenv.create(name, dir, { lang: "node", version: "latest", ports: [] }))).message, /Invalid version/);
  assert.deepEqual(calls, []);
});

test("create pulls, replaces the container, writes shims, config and devcontainer.json", { skip: linuxPaths }, async () => {
  const { name, dir } = repo();
  owner[devenv.containerName(name)] = dir; // its own container from a previous create
  const st = await devenv.create(name, dir, { lang: "python", version: "3.12", ports: [8000, 8000, 0, 70000, 1.5, "9000"] as unknown as number[] });
  assert.equal(st.state, "running");
  assert.equal(st.devcontainerWritten, true);
  assert.equal(st.config?.image, "python:3.12-bookworm");
  assert.deepEqual(st.config?.ports, [8000, 9000]);
  const verbs = calls.map((c) => c[0]);
  assert.deepEqual(verbs.slice(0, 5), ["inspect", "pull", "inspect", "rm", "run"], "who owns the name is checked first, and again before rm");
  const runArgs = calls.find((c) => c[0] === "run")!;
  assert.ok(!runArgs.some((a) => a.startsWith(`${projects}:`)), "projects/ (other projects, secrets/) is never mounted");
  assert.deepEqual(runArgs.filter((a, i) => runArgs[i - 1] === "-v"), [`${dir}:${dir}`], "only the repo");
  assert.equal(runArgs[runArgs.indexOf("--name") + 1], devenv.containerName(name));
  assert.equal(st.config?.container, devenv.containerName(name), "the config records the name");
  assert.equal(st.outdated, undefined);
  assert.ok(!runArgs.some((a) => a.endsWith("/.git:ro")), "no .git here, nothing to protect");
  assert.ok(runArgs.includes("127.0.0.1:8000:8000") && runArgs.includes("127.0.0.1:9000:9000"));
  assert.ok(runArgs.includes(`agent-os-nexo.project=${name}`));
  assert.deepEqual(runArgs.slice(-3), ["python:3.12-bookworm", "sleep", "infinity"]);

  const sd = devenv.shimDir(name);
  for (const f of ["python", "pip3", "ctr", "env.sh", "bashrc", "config.json"]) assert.ok(existsSync(join(sd, f)), f);
  const shim = readFileSync(join(sd, "python"), "utf8");
  assert.match(shim, /exec "\$D" exec \$T -w "\$W" -e TERM "\$C" python "\$@"/);
  assert.ok(shim.includes(`W='${dir}'`) && shim.includes(`for R in '${dir}'; do`), "works in the repo unless the cwd is a mounted tree");
  assert.ok(shim.includes(`'${join(projects, name, "worktrees")}'/*) echo "agent-os-nexo: this worktree was created after the dev container`), "an unmounted worktree fails loudly");
  assert.equal(runArgs[runArgs.indexOf("-w") + 1], dir);
  assert.match(readFileSync(join(sd, "env.sh"), "utf8"), /AGENT_OS_CONTAINER='agentos-/);
  assert.equal(devenv.hasDevEnv(name), true);
  const dc = JSON.parse(readFileSync(join(dir, ".devcontainer", "devcontainer.json"), "utf8"));
  assert.equal(dc.image, "python:3.12-bookworm");
  assert.deepEqual(dc.forwardPorts, [8000, 9000]);
  assert.match(devenv.promptNote(name), /agentos-.*python, python3, pip, pip3.*8000, 9000/);
});

test("create keeps an existing devcontainer.json and mounts a git repo's .git read-only plus its worktrees", { skip: linuxPaths }, async () => {
  const { name, dir } = repo({}, "gitproj");
  await run("git", ["init", "-q", dir]);
  const git = (...a: string[]) => run("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  await git("commit", "-q", "--allow-empty", "-m", "init");
  const wt = join(projects, name, "worktrees", "feat");
  mkdirSync(join(projects, name, "worktrees"), { recursive: true });
  await git("worktree", "add", "-q", wt, "-b", "feat");
  mkdirSync(join(dir, ".devcontainer"));
  writeFileSync(join(dir, ".devcontainer", "devcontainer.json"), "{}");
  const st = await devenv.create(name, dir, { lang: "go", version: "1.23", ports: [] });
  assert.equal(st.devcontainerWritten, false);
  assert.equal(readFileSync(join(dir, ".devcontainer", "devcontainer.json"), "utf8"), "{}");
  const args = calls.find((c) => c[0] === "run")!;
  const real = realpathSync(dir);
  const realWt = realpathSync(wt);
  assert.ok(args.includes(`${real}:${real}`) && args.includes(`${realWt}:${realWt}`));
  assert.ok(args.includes(`${real}/.git:${real}/.git:ro`));
  assert.ok(args.includes(`${realWt}/.git:${realWt}/.git:ro`));
  assert.ok(existsSync(join(devenv.shimDir(name), "gofmt")));
});

test("create refuses a second run for the same project while one is in flight", async () => {
  const { name, dir } = repo();
  const first = devenv.create(name, dir, { lang: "node", version: "22", ports: [] });
  const second = await fails(devenv.create(name, dir, { lang: "node", version: "22", ports: [] }));
  assert.equal(second.status, 409);
  await first;
  await devenv.create(name, dir, { lang: "node", version: "22", ports: [] }); // free again afterwards
});

test("a failed run drops the old shims; a missing old container on rm is fine, other rm errors are not", async () => {
  const { name, dir } = repo();
  owner[devenv.containerName(name)] = dir;
  await devenv.create(name, dir, { lang: "node", version: "20", ports: [] });
  assert.equal(devenv.hasDevEnv(name), true);
  reply = (a) => (a[0] === "run" ? { err: true, stderr: "port is already allocated" } : { stdout: "" });
  assert.match((await fails(devenv.create(name, dir, { lang: "node", version: "20", ports: [] }))).message, /port is already allocated/);
  assert.equal(devenv.hasDevEnv(name), false);
  reply = (a) => (a[0] === "rm" ? { err: true, stderr: "Error: No such container: x" } : { stdout: "true" });
  await devenv.create(name, dir, { lang: "node", version: "20", ports: [] });
  reply = (a) => (a[0] === "rm" ? { err: true, stderr: "permission denied" } : { stdout: "" });
  assert.match((await fails(devenv.create(name, dir, { lang: "node", version: "20", ports: [] }))).message, /permission denied/);
});

test("a failed pull leaves the working container and shims alone", async () => {
  const { name, dir } = repo();
  await devenv.create(name, dir, { lang: "node", version: "20", ports: [] });
  calls = [];
  reply = (a) => (a[0] === "pull" ? { err: true, stderr: "manifest unknown" } : { stdout: "" });
  await fails(devenv.create(name, dir, { lang: "node", version: "99", ports: [] }));
  assert.equal(devenv.hasDevEnv(name), true);
  assert.ok(!calls.some((c) => c[0] === "rm"));
});

test("status: running, stopped, missing, and unknown when docker does not answer", async () => {
  const { name, dir } = repo({ "go.mod": "module x\ngo 1.22\n" });
  reply = () => ({ stdout: "true\n" });
  const running = await devenv.status(name, dir);
  assert.equal(running.state, "running");
  assert.equal(running.config, null);
  assert.equal(running.detected[0]!.lang, "go");
  reply = () => ({ stdout: "false\n" });
  assert.equal((await devenv.status(name, dir)).state, "stopped");
  reply = () => ({ err: true, stderr: "Error: No such object: x" });
  assert.equal((await devenv.status(name, dir)).state, "missing");
  reply = () => ({ err: true, stderr: "Cannot connect to the Docker daemon" });
  const unknown = await devenv.status(name, dir);
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.error!, /not running/);
});

test("a corrupt or foreign config.json reads as no config, and promptNote stays empty", async () => {
  const { name, dir } = repo();
  await devenv.create(name, dir, { lang: "node", version: "22", ports: [] });
  const cfg = join(devenv.shimDir(name), "config.json");
  writeFileSync(cfg, JSON.stringify({ lang: "cobol" }));
  assert.equal((await devenv.status(name, dir)).config, null);
  assert.equal(devenv.promptNote(name), "");
  writeFileSync(cfg, "{nope");
  assert.equal((await devenv.status(name, dir)).config, null);
  assert.equal(devenv.promptNote(name), "");
});

test("remove deletes the container and shims; tolerates a missing container; validates the name", async () => {
  const { name, dir } = repo();
  await devenv.create(name, dir, { lang: "node", version: "22", ports: [] });
  const container = devenv.containerName(name);
  owner[container] = dir;
  await devenv.remove(name, dir);
  assert.deepEqual(calls.at(-1), ["rm", "-f", container]);
  assert.equal(devenv.hasDevEnv(name), false);
  reply = () => ({ err: true, stderr: "No such container: x" });
  await devenv.remove(name, dir);
  reply = () => ({ err: true, stderr: "daemon exploded" });
  assert.match((await fails(devenv.remove(name, dir))).message, /daemon exploded/);
  assert.equal((await fails(devenv.remove("a b", dir))).status, 400);
  devenv.forgetShims("a b"); // invalid ids are ignored, never turned into a path
});

test("a container of another repository with the same name is never replaced nor removed", async () => {
  const { name, dir } = repo();
  owner[devenv.containerName(name)] = "/other/env/projects/x/code";
  const e = await fails(devenv.create(name, dir, { lang: "node", version: "22", ports: [] }));
  assert.equal(e.status, 409);
  assert.match(e.message, /another repository \(\/other\/env/);
  assert.ok(!calls.some((c) => c[0] === "rm" || c[0] === "run" || c[0] === "pull"));
  assert.equal((await fails(devenv.remove(name, dir))).status, 409);
  owner[devenv.containerName(name)] = "";
  assert.match((await fails(devenv.remove(name, dir))).message, /not created by agent-os-nexo/);
  owner[devenv.containerName(name)] = dir;
  await devenv.remove(name, dir); // its own container goes
  assert.deepEqual(calls.at(-1), ["rm", "-f", devenv.containerName(name)]);
  owner[devenv.containerName(name)] = DOWN;
  assert.match((await fails(devenv.remove(name, dir))).message, /daemon exploded/, "an unanswered lookup is not 'no container'");
});

test("status flags another repository's container instead of reporting it as this project's", async () => {
  const { name, dir } = repo();
  reply = () => ({ stdout: "true|/other/env/projects/x/code\n" });
  const st = await devenv.status(name, dir);
  assert.equal(st.state, "unknown");
  assert.match(st.error!, /belongs to another repository/);
  reply = () => ({ stdout: `false|${dir}\n` });
  assert.equal((await devenv.status(name, dir)).state, "stopped");
});

test("a container from before environment names keeps its name, is flagged outdated, and is replaced on create", { skip: linuxPaths }, async () => {
  const { name, dir } = repo();
  const legacy = `agentos-${name}`;
  mkdirSync(devenv.shimDir(name), { recursive: true });
  writeFileSync(join(devenv.shimDir(name), "config.json"), JSON.stringify({ lang: "node", version: "20", ports: [], image: "node:20-bookworm" }));
  writeFileSync(devenv.envFile(name), "");
  assert.equal(devenv.containerName(name), legacy);
  const st = await devenv.status(name, dir);
  assert.equal(st.container, legacy);
  assert.equal(st.outdated, true);
  owner[legacy] = dir;
  await devenv.create(name, dir, { lang: "node", version: "22", ports: [] });
  const fresh = devenv.containerName(name);
  assert.notEqual(fresh, legacy);
  assert.deepEqual(calls.filter((c) => c[0] === "rm"), [["rm", "-f", legacy]], "the fresh name held nothing");
  assert.equal(calls.find((c) => c[0] === "run")![calls.find((c) => c[0] === "run")!.indexOf("--name") + 1], fresh);
});

test("an old-style name held by another environment is left alone: create moves on, remove only drops the shims", async () => {
  const { name, dir } = repo();
  const legacy = `agentos-${name}`;
  const legacyConfig = () => {
    mkdirSync(devenv.shimDir(name), { recursive: true });
    writeFileSync(join(devenv.shimDir(name), "config.json"), JSON.stringify({ lang: "node", version: "20", ports: [], image: "node:20-bookworm" }));
    writeFileSync(devenv.envFile(name), "");
  };
  legacyConfig();
  owner[legacy] = "/other/env/projects/x/code";
  await devenv.remove(name, dir);
  assert.ok(!calls.some((c) => c[0] === "rm"), "never removes the other environment's container");
  assert.equal(devenv.hasDevEnv(name), false);
  legacyConfig();
  calls = [];
  await devenv.create(name, dir, { lang: "node", version: "22", ports: [] });
  assert.ok(!calls.some((c) => c[0] === "rm" && c[2] === legacy));
  assert.notEqual(devenv.containerName(name), legacy, "this project now has its own name");
});
