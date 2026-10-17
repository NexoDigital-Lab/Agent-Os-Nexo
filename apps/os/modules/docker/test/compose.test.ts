// compose.ts: file discovery, service classification, the config reduction that drops environment values, start
// profiles on disk, status reduction and the argv of each action. Docker is a fake launcher that records argv.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import * as docker from "../server/docker.ts";
import * as compose from "../server/compose.ts";

type Reply = { stdout?: string; stderr?: string; err?: boolean; wait?: Promise<void> };
let calls: string[][] = [];
let reply: (args: string[]) => Reply = () => ({});
let gate: Promise<void> = Promise.resolve();
beforeEach(() => {
  calls = [];
  gate = Promise.resolve();
  reply = () => ({ stdout: "" });
  docker.dockerExec.execFile = ((_f: string, args: string[], _o: unknown, cb: (e: unknown, o: string, s: string) => void) => {
    calls.push(args);
    const r = reply(args);
    void (r.wait ?? gate).then(() => setImmediate(() => cb(r.err ? new Error("x") : null, r.stdout ?? "", r.stderr ?? "")));
  }) as unknown as typeof docker.dockerExec.execFile;
});
const fails = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e as Error & { status: number };
  }
  return assert.fail("should throw");
};

let n = 0;
function project(files: Record<string, string> = {}) {
  const dir = realpathSync(tempDir("compose-"));
  const repo = join(dir, "code");
  mkdirSync(join(dir, "context"), { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(repo, f, ".."), { recursive: true });
    writeFileSync(join(repo, f), c);
  }
  mkdirSync(repo, { recursive: true });
  return { dir, repo, id: `p${n++}` };
}

const CONFIG = {
  name: "shop",
  services: {
    db: {
      image: "postgres:16-alpine",
      ports: [{ target: 5432, published: "5433", host_ip: "127.0.0.1" }, { target: "nope" }],
      environment: { POSTGRES_PASSWORD: "s3cr3t-from-dotenv" },
    },
    api: { build: { context: "." }, depends_on: { db: { condition: "service_healthy" } }, ports: [{ target: 3000 }], environment: { JWT: "s3cr3t-jwt" } },
    adminer: { image: "adminer", depends_on: ["db"], container_name: "shop-adminer", profiles: ["tools"] },
  },
};

test("findFiles finds compose and Dockerfiles up to depth 3, skipping dependency and hidden folders", () => {
  const { repo } = project({
    "docker-compose.yml": "",
    "compose.prod.yaml": "",
    "Dockerfile": "",
    "api/Dockerfile.dev": "",
    "web/app.dockerfile": "",
    "a/b/c/compose.yml": "",
    "a/b/c/d/compose.yml": "",
    "node_modules/x/compose.yml": "",
    ".github/compose.yml": "",
    "notes.yml": "",
  });
  assert.deepEqual(compose.findFiles(repo), {
    compose: ["a/b/c/compose.yml", "compose.prod.yaml", "docker-compose.yml"],
    dockerfiles: ["api/Dockerfile.dev", "Dockerfile", "web/app.dockerfile"],
  });
  assert.deepEqual(compose.findFiles(join(repo, "missing")), { compose: [], dockerfiles: [] });
});

test("classify tells databases, database UIs and apps apart by image", () => {
  assert.deepEqual(compose.classify("postgres:16-alpine"), { kind: "db", engine: "postgres" });
  assert.deepEqual(compose.classify("bitnami/postgresql:16"), { kind: "db", engine: "postgres" });
  assert.deepEqual(compose.classify("pgvector/pgvector:pg16"), { kind: "db", engine: "postgres" });
  assert.deepEqual(compose.classify("docker.io/library/mariadb:11@sha256:abc"), { kind: "db", engine: "mariadb" });
  assert.deepEqual(compose.classify("mysql"), { kind: "db", engine: "mysql" });
  assert.deepEqual(compose.classify("mongo:7"), { kind: "db", engine: "mongo" });
  assert.deepEqual(compose.classify("redis:7-alpine"), { kind: "db", engine: "redis" });
  assert.deepEqual(compose.classify("valkey/valkey"), { kind: "db", engine: "redis" });
  assert.deepEqual(compose.classify("adminer"), { kind: "db-ui", engine: null });
  assert.deepEqual(compose.classify("ghcr.io/x/redis-commander:latest"), { kind: "db-ui", engine: null });
  assert.deepEqual(compose.classify("quay.io/keycloak/keycloak:25"), { kind: "app", engine: null });
  assert.deepEqual(compose.classify(null), { kind: "app", engine: null });
});

test("services keeps names, images, ports and dependencies, and never an environment value", () => {
  const out = compose.services(CONFIG);
  assert.ok(!JSON.stringify(out).includes("s3cr3t"), "environment values never leave compose.ts");
  assert.deepEqual(out.map((s) => [s.name, s.kind, s.engine]), [["db", "db", "postgres"], ["api", "app", null], ["adminer", "db-ui", null]]);
  assert.deepEqual(out[0]!.ports, [{ target: 5432, published: 5433, hostIp: "127.0.0.1" }]);
  assert.deepEqual(out[1]!.ports, [{ target: 3000, published: null, hostIp: null }]);
  assert.equal(out[1]!.build, true);
  assert.deepEqual(out[1]!.dependsOn, ["db"]);
  assert.deepEqual(out[2]!.dependsOn, ["db"]);
  assert.equal(out[2]!.containerName, "shop-adminer");
  assert.deepEqual(out[2]!.profiles, ["tools"]);
  assert.deepEqual(compose.services(null), []);
});

test("detect resolves each compose file through docker and keeps a file's error", async () => {
  const { repo } = project({ "docker-compose.yml": "", "docker-compose.prod.yml": "", "Dockerfile": "" });
  reply = (a) => (a[2]!.endsWith("prod.yml") ? { err: true, stderr: "env file .env.prod not found" } : { stdout: JSON.stringify(CONFIG) });
  const d = await compose.detect(repo);
  assert.deepEqual(d.dockerfiles, ["Dockerfile"]);
  assert.equal(d.compose.length, 2);
  const [prod, dev] = d.compose;
  assert.deepEqual([prod!.file, prod!.prod, prod!.error], ["docker-compose.prod.yml", true, "env file .env.prod not found"]);
  assert.deepEqual([dev!.file, dev!.prod, dev!.project, dev!.services.length], ["docker-compose.yml", false, "shop", 3]);
  assert.ok(!JSON.stringify(d).includes("s3cr3t"));
  assert.deepEqual(calls.find((c) => /[\\/]docker-compose\.yml$/.test(c[2]!)), ["compose", "-f", join(repo, "docker-compose.yml"), "config", "--format", "json"]);
});

test("linkedStacks keeps the compose projects with a config file inside the repo", async () => {
  const { repo } = project();
  reply = () => ({
    stdout: JSON.stringify([
      { Name: "shop", Status: "running(2)", ConfigFiles: `${join(repo, "docker-compose.yml")},/old/checkout/docker-compose.yml` },
      { Name: "other", Status: "exited(1)", ConfigFiles: "/elsewhere/compose.yml" },
      { Name: "sneaky", Status: "running(1)", ConfigFiles: `${repo}-evil/compose.yml` },
    ]),
  });
  assert.deepEqual(await compose.linkedStacks(repo), [{ name: "shop", status: "running(2)", files: ["docker-compose.yml"] }]);
  reply = () => ({ stdout: "" });
  assert.deepEqual(await compose.linkedStacks(repo), []);
});

test("saved profiles: validated against the repo, written to context/docker.json, read back", async () => {
  const { dir, repo } = project({ "docker-compose.yml": "", "README.md": "" });
  const good = { version: 1, default: "dev", profiles: { dev: { label: "Dev", files: ["docker-compose.yml"], projectName: "shop", services: ["db", "db"], stop: "stop" } } };
  const bad = (patch: Record<string, unknown>, def = "dev") => fails(() => compose.saveStack(dir, repo, { default: def, profiles: { dev: { ...good.profiles.dev, ...patch } } }));
  assert.match((await bad({ files: [] })).message, /no compose file/);
  assert.match((await bad({ files: ["../x/docker-compose.yml"] })).message, /outside the project/);
  assert.match((await bad({ files: ["README.md"] })).message, /Not a compose file/);
  assert.match((await bad({ files: ["compose.yml"] })).message, /Not a compose file/, "it must exist");
  assert.match((await bad({ projectName: "Shop Name" })).message, /Invalid compose project name/);
  assert.match((await bad({ services: ["--rm"] })).message, /Invalid service name/);
  assert.match((await bad({ stop: "down -v" })).message, /Invalid stop mode/);
  assert.match((await bad({ stop: "down" })).message, /cannot be limited to some services/, "down takes the whole project");
  assert.match((await bad({}, "prod")).message, /default profile/);
  assert.match((await fails(() => compose.saveStack(dir, repo, { default: "x", profiles: { "a b": good.profiles.dev } }))).message, /Invalid profile id/);
  assert.match((await fails(() => compose.saveStack(dir, repo, {}))).message, /At least one profile/);
  assert.equal(compose.readStack(dir), null);

  const saved = compose.saveStack(dir, repo, good);
  assert.deepEqual(saved.profiles.dev!.services, ["db"]);
  assert.deepEqual(compose.readStack(dir), saved);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "context", "docker.json"), "utf8")), saved);
});

test("a hand-broken docker.json reads as no profiles and is left where it is", () => {
  const { dir } = project();
  writeFileSync(join(dir, "context", "docker.json"), "{ oops");
  assert.equal(compose.readStack(dir), null);
  assert.deepEqual(readdirSync(join(dir, "context")), ["docker.json"]);
  writeFileSync(join(dir, "context", "docker.json"), JSON.stringify({ version: 2, profiles: {} }));
  assert.equal(compose.readStack(dir), null);
  writeFileSync(join(dir, "context", "docker.json"), JSON.stringify({ version: 1, profiles: [] }));
  assert.equal(compose.readStack(dir), null);
});

test("propose makes one profile per readable compose file and defaults to the one that is not production", () => {
  const svc = compose.services(CONFIG);
  const d: compose.Detection = {
    dockerfiles: [],
    compose: [
      { file: "docker-compose.prod.yml", project: "shop", prod: true, services: svc },
      { file: "docker-compose.yml", project: "shop", prod: false, services: svc },
      { file: "deploy/compose.yml", project: "Bad Name", prod: false, services: svc },
      { file: "broken.compose.yml", project: null, prod: false, services: [], error: "x" },
    ],
  };
  const p = compose.propose(d, "/env/projects/My Shop/code")!;
  assert.deepEqual(Object.keys(p.profiles), ["prod", "default", "default-2"]);
  assert.equal(p.default, "default");
  assert.deepEqual(p.profiles.prod, { label: "docker-compose.prod.yml", files: ["docker-compose.prod.yml"], projectName: "shop", services: [], stop: "stop" });
  assert.equal(p.profiles["default-2"]!.projectName, "code", "an invalid compose name falls back to the folder");
  assert.equal(compose.propose({ dockerfiles: [], compose: [d.compose[0]!] }, "/r")!.default, "prod", "only prod: it is still the default");
  assert.equal(compose.propose({ dockerfiles: ["Dockerfile"], compose: [] }, "/r"), null);
  const withOverride = compose.propose({ dockerfiles: [], compose: [
    { file: "docker-compose.override.yml", project: "shop", prod: false, services: svc },
    { file: "docker-compose.yml", project: "shop", prod: false, services: svc },
  ] }, "/r")!;
  assert.deepEqual(withOverride.profiles, { default: { label: "docker-compose.yml", files: ["docker-compose.yml", "docker-compose.override.yml"], projectName: "shop", services: [], stop: "stop" } }, "an override joins its base file");
  assert.equal(compose.isProd(p.profiles.prod!), true);
  assert.equal(compose.isProd(p.profiles.default!), false);
  assert.equal(compose.isProd({ ...p.profiles.default!, projectName: "shop-prod" }), true);
  assert.equal(compose.isProd({ ...p.profiles.default!, files: ["reproduce.yml"] }), false, "only prod as a word");
  assert.equal(compose.isProd({ ...p.profiles.default!, files: ["products/compose.yml"] }), false);
  assert.equal(compose.isProd({ ...p.profiles.default!, files: ["compose.production.yml"] }), true);
});

test("reduce turns container states into one stack state", () => {
  const row = (service: string, state: string, health = "", exitCode = 0) => ({ service, container: service, state, health, exitCode, ports: [] });
  assert.equal(compose.reduce([], []), "stopped");
  assert.equal(compose.reduce([row("db", "running", "starting")], []), "starting");
  assert.equal(compose.reduce([row("db", "created")], []), "starting");
  assert.equal(compose.reduce([row("db", "running"), row("api", "running", "healthy")], []), "running");
  assert.equal(compose.reduce([row("db", "running")], ["db", "api"]), "partial", "a wanted service is missing");
  assert.equal(compose.reduce([row("db", "running"), row("api", "exited", "", 1)], []), "partial");
  assert.equal(compose.reduce([row("db", "running", "unhealthy")], []), "partial");
  assert.equal(compose.reduce([row("api", "exited", "", 1)], []), "error");
  assert.equal(compose.reduce([row("api", "exited", "", 137), row("db", "exited", "", 143)], []), "stopped", "killed by a stop is not a failure");
  assert.equal(compose.reduce([row("api", "exited")], []), "stopped");
  assert.equal(compose.reduce([row("api", "running"), row("migrate", "exited")], []), "running", "a finished one-shot service is fine");
});

const profile: compose.Profile = { files: ["docker-compose.yml"], projectName: "shop", services: [], stop: "stop" };

test("status reads compose ps as json lines or an array, filtered to the profile's services", async () => {
  const { repo } = project({ "docker-compose.yml": "" });
  const line = (Service: string, State: string, extra = {}) => JSON.stringify({ Service, Name: `shop-${Service}-1`, State, Health: "", ExitCode: 0, ...extra });
  reply = () => ({ stdout: `${line("db", "running", { Publishers: [{ URL: "127.0.0.1", TargetPort: 5432, PublishedPort: 5433 }, { TargetPort: 0 }] })}\n${line("api", "running")}\n` });
  const st = await compose.status("shop", "dev", profile, repo);
  assert.equal(st.state, "running");
  assert.deepEqual(st.services[0]!.ports, [{ target: 5432, published: 5433, hostIp: "127.0.0.1" }]);
  assert.deepEqual(calls[0], ["compose", "-p", "shop", "-f", join(repo, "docker-compose.yml"), "ps", "-a", "--format", "json"]);
  reply = () => ({ stdout: `[${line("db", "running")},${line("api", "exited", { ExitCode: 1 })}]` });
  const only = await compose.status("shop", "dev", { ...profile, services: ["db"] }, repo);
  assert.deepEqual([only.state, only.services.map((s) => s.service)], ["running", ["db"]]);
  reply = () => ({ stdout: "  " });
  assert.deepEqual(await compose.status("shop", "dev", profile, repo), { state: "stopped", services: [], busy: null, lastError: null });
});

test("actionArgs: up and restart take the profile's services; stop or down, never -v", () => {
  const withSvc = { ...profile, services: ["db", "api"] };
  const { repo: real } = project({ "docker-compose.yml": "" }); // safePath checks symlinks on disk
  const rb = ["compose", "-p", "shop", "-f", join(real, "docker-compose.yml")];
  assert.deepEqual(compose.actionArgs("up", profile, real), [...rb, "up", "-d"]);
  assert.deepEqual(compose.actionArgs("up", withSvc, real), [...rb, "up", "-d", "db", "api"]);
  assert.deepEqual(compose.actionArgs("restart", withSvc, real), [...rb, "restart", "db", "api"]);
  assert.deepEqual(compose.actionArgs("stop", profile, real), [...rb, "stop"]);
  assert.deepEqual(compose.actionArgs("stop", { ...profile, stop: "down" }, real), [...rb, "down"]);
  assert.deepEqual(compose.actionArgs("stop", { ...withSvc, stop: "down" }, real), [...rb, "stop", "db", "api"], "down would take the whole project");
  for (const a of ["up", "stop", "restart"] as const) assert.ok(!compose.actionArgs(a, { ...profile, stop: "down" }, real).includes("-v"));
});

/** A docker that answers the checks act() makes before starting: no other owner of -p, a local engine, an empty config. */
const checksOk = (a: string[], action: Reply = { stdout: "" }): Reply =>
  a[0] === "ps" ? { stdout: "" } : a[0] === "context" ? { stdout: "unix:///var/run/docker.sock\n" } : a.includes("config") ? { stdout: '{"services":{}}' } : a.includes("ps") ? { stdout: "" } : action;

test("act runs in the background: busy while it runs, one at a time, its error kept until the next run", async () => {
  const { repo } = project({ "docker-compose.yml": "" });
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  reply = (a) => checksOk(a, { err: true, stderr: "Container shop-db-1 Creating\nError response from daemon: port 5433 is already allocated", wait: held });
  assert.deepEqual(await compose.act("shop", "dev", profile, repo, "up"), { started: "up" });
  assert.equal((await fails(compose.act("shop", "dev", profile, repo, "stop"))).status, 409);
  await compose.act("shop", "other", profile, repo, "stop"); // another profile is independent
  const during = await compose.status("shop", "dev", profile, repo);
  assert.deepEqual([during.state, during.busy], ["starting", "up"]);
  assert.equal((await compose.status("shop", "other", profile, repo)).state, "stopping");
  release();
  await new Promise((r) => setTimeout(r, 20));
  const after = await compose.status("shop", "dev", profile, repo);
  assert.deepEqual([after.state, after.busy, after.lastError], ["stopped", null, "Error response from daemon: port 5433 is already allocated"]);
  reply = (a) => checksOk(a);
  await compose.act("shop", "dev", profile, repo, "up");
  assert.equal((await compose.status("shop", "dev", profile, repo)).lastError, null, "a new run clears the old error");
});

test("act asks for a confirmation with the reasons: production, a remote engine, a stack asking for more than its repo", async () => {
  const { repo } = project({ "docker-compose.prod.yml": "" });
  const prod: compose.Profile = { files: ["docker-compose.prod.yml"], projectName: "shop", services: [], stop: "stop" };
  const risky = { services: { web: { privileged: true, volumes: [{ type: "bind", source: "/var/run/docker.sock" }] } } };
  reply = (a) => (a[0] === "context" ? { stdout: "tcp://10.0.0.5:2376\n" } : a.includes("config") ? { stdout: JSON.stringify(risky) } : checksOk(a));
  const e = await fails(compose.act("shop", "p1", prod, repo, "up"));
  assert.equal(e.status, 409);
  assert.match(e.message, /^Confirm to continue: this profile looks like production; the active Docker context is another machine; web: privileged; web: the Docker socket/);
  assert.ok(!calls.some((c) => c.includes("up")), "nothing started");
  assert.deepEqual(await compose.act("shop", "p1", prod, repo, "up", true), { started: "up" }, "confirmed");
  await new Promise((r) => setTimeout(r, 10));
  calls = [];
  const stop = await fails(compose.act("shop", "p1", prod, repo, "stop"));
  assert.doesNotMatch(stop.message, /privileged/, "stopping does not depend on what the stack asks for");
  assert.ok(!calls.some((c) => c.includes("config")));
});

test("act refuses a -p that names another repository's compose project, even confirmed", async () => {
  const { repo } = project({ "docker-compose.yml": "" });
  reply = (a) => (a[0] === "ps" ? { stdout: `${join(repo, "docker-compose.yml")}\n/other/repo/compose.yml\n` } : checksOk(a));
  const e = await fails(compose.act("shop", "p2", profile, repo, "up", true));
  assert.equal(e.status, 409);
  assert.match(e.message, /belongs to files outside this repository \(\/other\/repo\/compose.yml\)/);
  assert.deepEqual(calls[0]!.slice(0, 4), ["ps", "-a", "--filter", "label=com.docker.compose.project=shop"]);
  // Docker on Windows may record a mix of separators: still this repo's file.
  reply = (a) => (a[0] === "ps" ? { stdout: `${repo}/docker-compose.yml,/old/checkout/docker-compose.yml\n` } : checksOk(a));
  assert.deepEqual(await compose.act("shop", "p2", profile, repo, "up"), { started: "up" }, "one of its files is here: it is this project's");
  await new Promise((r) => setTimeout(r, 10));
});

test("risks lists privileges, host namespaces, devices, the socket and host folders outside the repo", () => {
  const repo = "/env/projects/shop/code";
  assert.deepEqual(compose.risks({ services: {
    a: { privileged: true, pid: "host", network_mode: "host", cap_add: ["SYS_ADMIN"], devices: ["/dev/kvm"] },
    b: { volumes: [{ type: "bind", source: `${repo}/data` }, { type: "volume", source: "pgdata" }, { type: "bind", source: "/etc" }, { type: "bind", source: "/var/run/docker.sock" }] },
    c: { build: { context: "/elsewhere" } },
    d: { build: { context: `${repo}/api` }, network_mode: "bridge" },
    e: { build: { context: "https://github.com/x/y.git" } },
  } }, repo), [
    "a: privileged", "a: pid host", "a: network_mode host", "a: cap_add SYS_ADMIN", "a: host devices",
    "b: host folder /etc", "b: the Docker socket (/var/run/docker.sock)",
    "c: builds from /elsewhere",
  ]);
  assert.deepEqual(compose.risks({}, repo), []);
});

test("compose never gets the server's own secrets in its environment", () => {
  assert.ok(Object.keys(docker.COMPOSE_ENV).every((k) => !/KEY|TOKEN|SECRET|PASSWORD/i.test(k) || k.startsWith("DOCKER_") || k.startsWith("COMPOSE_")));
  assert.equal(docker.COMPOSE_ENV.PATH, docker.DOCKER_ENV.PATH);
});

test("logs of one service or all, with the service name checked", async () => {
  const { repo } = project({ "docker-compose.yml": "" });
  reply = () => ({ stdout: "db-1 | ready\n" });
  assert.equal(await compose.logs(profile, repo, "db"), "db-1 | ready\n");
  assert.deepEqual(calls.at(-1)!.slice(-6), ["logs", "--no-color", "--timestamps", "--tail", "300", "db"]);
  await compose.logs(profile, repo);
  assert.equal(calls.at(-1)!.at(-1), "300");
  assert.equal((await fails(() => compose.logs(profile, repo, "-f"))).status, 400);
});

test("contextIsLocal: unix sockets and named pipes are local; tcp and ssh are not", async () => {
  for (const [host, local] of [["unix:///var/run/docker.sock", true], ["npipe:////./pipe/docker_engine", true], ["tcp://10.0.0.5:2376", false], ["ssh://me@prod", false]] as const) {
    reply = () => ({ stdout: `${host}\n` });
    assert.equal(await compose.contextIsLocal(), local, host);
  }
  reply = () => ({ err: true, stderr: "x" });
  assert.equal(await compose.contextIsLocal(), true, "unknown: no warning");
});
