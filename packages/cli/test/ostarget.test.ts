// A build that runs on this machine: runtimes per OS/CPU/Node ABI, the preflight, the smoke test that keeps or
// rolls back a build, and doctor's check of the active build's target.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { os, osDeps } from "../src/commands/os.ts";
import { diagnose } from "../src/commands/doctor.ts";
import { buildTarget, currentTarget, meetsEngine, preflight, runtimeHash, smokeTest, TARGET_FILE, type Runner } from "../src/core/osruntime.ts";

test("one runtime per target: the same dependencies on another OS, CPU or Node ABI get their own", () => {
  const pkg = { dependencies: { a: "1" } };
  assert.equal(runtimeHash(pkg), runtimeHash(pkg, currentTarget()));
  assert.notEqual(runtimeHash(pkg, "linux-x64-node137"), runtimeHash(pkg, "win32-x64-node137"));
  assert.notEqual(runtimeHash(pkg, "linux-x64-node137"), runtimeHash(pkg, "linux-arm64-node137"));
  assert.notEqual(runtimeHash(pkg, "linux-x64-node127"), runtimeHash(pkg, "linux-x64-node137"));
  assert.match(currentTarget(), /^(linux|darwin|win32)-(x64|arm64)-node\d+$/);
});

test("meetsEngine reads >= ranges and leaves the rest to npm", () => {
  assert.ok(meetsEngine("22.18.0", ">=22.18"));
  assert.ok(meetsEngine("v24.1.0", ">=22.18"));
  assert.ok(meetsEngine("22.18.1", ">= 22.18.1"));
  assert.ok(!meetsEngine("22.17.9", ">=22.18"));
  assert.ok(!meetsEngine("20.99.0", ">=22"));
  assert.ok(meetsEngine("18.0.0", "^24 || ^22"), "a form it does not read is not blocked here");
});

test("preflight: a supported OS/CPU and a Node that meets engines, with the way to update it per OS", () => {
  const src = tempDir();
  writeFileSync(join(src, "package.json"), JSON.stringify({ engines: { node: ">=22.18" } }));
  preflight(src, "linux", "x64", "22.18.0");
  assert.throws(() => preflight(src, "freebsd", "x64", "24.0.0"), /runs on linux\/darwin\/win32.*freebsd-x64/);
  assert.throws(() => preflight(src, "linux", "ia32", "24.0.0"), /linux-ia32/);
  assert.throws(() => preflight(src, "win32", "x64", "20.1.0"), /needs Node >=22\.18; this is 20\.1\.0\. Update it: winget install OpenJS\.NodeJS\.LTS/);
  assert.throws(() => preflight(src, "darwin", "arm64", "20.1.0"), /brew install node/);
  writeFileSync(join(src, "package.json"), JSON.stringify({}));
  preflight(src, "darwin", "arm64", "1.0.0");
});

// The same fake source and runner as commands.test.ts: the build copies `main` into the version's host/server.
function fakeSource(main: string): string {
  const src = join(tempDir(), "agent-os-nexo");
  for (const d of ["modules/shell", "scripts", "host/server"]) mkdirSync(join(src, d), { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "x", dependencies: { express: "^5" } }));
  writeFileSync(join(src, "scripts", "build.ts"), "");
  writeFileSync(join(src, "host", "server", "main.ts"), main);
  return src;
}
function runner(main: string): Runner {
  return (cmd, args, cwd) => {
    if (cmd === "npm") mkdirSync(join(cwd, "node_modules"), { recursive: true });
    if (cmd === process.execPath) {
      const out = args.find((a) => a.startsWith("--out="))!.slice(6);
      const runtime = args.find((a) => a.startsWith("--runtime="))!.slice(10);
      mkdirSync(join(out, "host", "server"), { recursive: true });
      writeFileSync(join(out, "host", "server", "main.ts"), main);
      writeFileSync(join(out, "build.json"), JSON.stringify({ runtime })); // as scripts/build.ts records it
    }
  };
}
const SERVE = (extra = "") => `import http from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
${extra}
http.createServer((_q, s) => { s.setHeader("X-Agent-OS-Nexo", "1"); s.end("{}"); }).listen(port, "127.0.0.1");
`;

test("a build that starts and loads every module is kept, its runtime records the target, doctor is satisfied", async () => {
  const root = await freshEnv("claude");
  await os("install", undefined, { root, from: fakeSource(SERVE()) }, runner(SERVE()));
  const runtime = readdirSync(join(root, "os", "runtime"))[0]!;
  assert.equal(readFileSync(join(root, "os", "runtime", runtime, TARGET_FILE), "utf8").trim(), currentTarget());
  assert.equal(buildTarget(join(root, "os"), "1.0.0"), currentTarget());
  assert.ok(!diagnose(root).some((f) => f.area === "agent-os-nexo"));
  const state = join(root, ".state", "os");
  assert.ok(!existsSync(state) || !readdirSync(state).some((f) => f.startsWith("token-")), "the test start leaves no token behind");
});

test("a build that does not start, or loads with a failing module, is rolled back with the reason", async () => {
  const root = await freshEnv("claude");
  await os("install", undefined, { root, from: fakeSource(SERVE()) }, runner(SERVE()));
  await assert.rejects(os("build", undefined, { root }, runner('console.error("Error: node-pty.node: invalid ELF header"); process.exit(1);\n')), /Build 1\.0\.1 was not kept: it exited on a test start\.\n.*invalid ELF header/s);
  await assert.rejects(os("build", undefined, { root }, runner(SERVE('console.warn("[modules] terminal failed to load and was skipped: Error: invalid ELF header");'))), /some modules did not load on this machine:\n.*terminal failed to load/);
  assert.deepEqual(readdirSync(join(root, "os", "versions")), ["1.0.0"], "nothing half-built is left");
});

test("doctor flags an active build installed for another machine; an unknown target is not flagged", async () => {
  const root = await freshEnv("claude");
  await os("install", undefined, { root, from: fakeSource(SERVE()) }, runner(SERVE()));
  const runtime = join(root, "os", "runtime", readdirSync(join(root, "os", "runtime"))[0]!);
  writeFileSync(join(runtime, TARGET_FILE), "plan9-mips-node1\n"); // a target no CI machine can be
  const finding = diagnose(root).find((f) => f.area === "agent-os-nexo");
  assert.match(finding?.message ?? "", /installed for plan9-mips-node1, this machine is .*: run `nexo os build`/);
  writeFileSync(join(runtime, TARGET_FILE), "");
  assert.equal(buildTarget(join(root, "os"), "9.9.9"), null, "a version that is not there");
  // A build without build.json (older ones): found through its node_modules link instead.
  writeFileSync(join(runtime, TARGET_FILE), "linux-x64-node1\n");
  rmSync(join(root, "os", "versions", "1.0.0", "build.json"));
  assert.equal(buildTarget(join(root, "os"), "1.0.0"), "linux-x64-node1");
});

test("the smoke test is swappable through osDeps", async () => {
  const root = await freshEnv("claude");
  const real = osDeps.smoke;
  osDeps.smoke = async () => "refused by the test";
  try {
    await assert.rejects(os("install", undefined, { root, from: fakeSource(SERVE()) }, runner(SERVE())), /was not kept: refused by the test/);
    assert.ok(!existsSync(join(root, "os", "versions", "1.0.0")));
  } finally {
    osDeps.smoke = real;
  }
  assert.equal(typeof smokeTest, "function");
});
