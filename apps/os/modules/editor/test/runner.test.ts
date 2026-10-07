// Run commands (detected + own) and toolchain detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, tempEnv } from "../../../host/test/harness.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { initRunner, runConfigs, saveRunConfigs, toolchains } from "../server/runner.ts";

const env = tempEnv({ system: { packageManager: "apt" } });
initProjects(env);
mkdirSync(join(env.projects, "demo", "code"), { recursive: true });
writeFileSync(join(env.projects, "demo", "AGENTS.md"), "# demo\n");
initRunner(env);

test("saved commands are cleaned: trimmed, capped, empty ones dropped, label defaults to the command", () => {
  const long = "x".repeat(600);
  const saved = saveRunConfigs("demo", [{ label: "  Dev  ", cmd: " npm run dev " }, { cmd: "make all" }, { label: "empty", cmd: "  " }, null, { label: "L".repeat(100), cmd: long }]);
  assert.equal(saved.length, 3);
  assert.deepEqual(saved.slice(0, 2), [{ label: "Dev", cmd: "npm run dev" }, { label: "make all", cmd: "make all" }]);
  assert.equal(saved[2].label.length, 60);
  assert.equal(saved[2].cmd.length, 500);
  const file = join(env.projects, "demo", "context", "run.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).commands.length, 3);
  assert.deepEqual(saveRunConfigs("demo", "nope"), [], "a non-list clears the commands");
});

test("runConfigs lists own commands first and detects commands from manifests", () => {
  const repo = tempDir("editor-run-");
  writeFileSync(join(repo, "go.mod"), "module x\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { dev: "vite", test: "node --test" } }));
  writeFileSync(join(repo, "pnpm-lock.yaml"), "");
  writeFileSync(join(repo, "Makefile"), "build:\n\techo\nVAR := 1\nbuild:\n\techo\ntest: build\n");
  writeFileSync(join(repo, "manage.py"), "");
  writeFileSync(join(repo, "Cargo.toml"), "");
  writeFileSync(join(repo, "compose.yml"), "");
  saveRunConfigs("demo", [{ label: "Mine", cmd: "make build" }]);
  const cmds = runConfigs("demo", repo);
  assert.deepEqual(cmds[0], { label: "Mine", cmd: "make build", source: "own" });
  const detected = cmds.filter((c) => c.source === "detected").map((c) => c.cmd);
  assert.ok(detected.includes("go test ./..."));
  assert.ok(detected.includes("pnpm run dev"));
  assert.ok(detected.includes("make test"));
  assert.equal(detected.includes("make build"), false, "an own command hides the same detected one");
  assert.equal(detected.filter((c) => c === "make test").length, 1);
  assert.ok(detected.includes("python3 manage.py runserver"));
  assert.ok(detected.includes("cargo test"));
  assert.ok(detected.includes("docker compose down"));
});

test("runConfigs picks yarn or npm and main.py when there is no manage.py", () => {
  const yarn = tempDir("editor-yarn-");
  writeFileSync(join(yarn, "package.json"), JSON.stringify({ scripts: { start: "x" } }));
  writeFileSync(join(yarn, "yarn.lock"), "");
  writeFileSync(join(yarn, "main.py"), "");
  writeFileSync(join(yarn, "docker-compose.yml"), "");
  const cmds = runConfigs("unknown-project", yarn).map((c) => c.cmd);
  assert.deepEqual(cmds.slice(0, 2), ["yarn run start", "python3 main.py"]);
  const npm = tempDir("editor-npm-");
  writeFileSync(join(npm, "package.json"), JSON.stringify({ scripts: { build: "x" } }));
  assert.deepEqual(runConfigs("unknown-project", npm).map((c) => c.cmd), ["npm run build"]);
  assert.deepEqual(runConfigs("unknown-project", tempDir("editor-bare-")), []);
});

test("toolchains reports git as needed and installed, with the configured package manager's install command", { skip: process.platform === "win32" ? "needs a bash login shell" : false }, async () => {
  const repo = tempDir("editor-tools-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "go.mod"), "module x\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "x" }));
  const tools = await toolchains(repo);
  const by = Object.fromEntries(tools.map((t) => [t.key, t]));
  assert.equal(by.git.needed, true);
  assert.equal(by.git.neededBy, "every project");
  assert.equal(by.git.installed, true);
  assert.match(by.git.version ?? "", /git version/);
  assert.equal(by.git.install, "sudo apt install -y git");
  assert.equal(by.go.needed, true);
  assert.equal(by.docker.needed, false);
  assert.equal(by.docker.neededBy, null);
  assert.equal(by.gopls.install, "go install golang.org/x/tools/gopls@latest");
  assert.ok(existsSync(by.git.path!));
});
