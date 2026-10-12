// nexo self-update: copies one commit of the CLI, never the working tree, and only rewrites its own launcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { writeText } from "../src/core/fsx.ts";
import { defaultLauncher, LAUNCHER_MARK, launcherText, ownLauncher, readCliState, selfUpdate } from "../src/core/selfupdate.ts";
import { selfUpdateCommand } from "../src/commands/selfupdate.ts";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" }).trim();

/** A checkout whose packages/cli is a tiny CLI at `version`, committed on main. */
function checkout(version = "1.2.3"): string {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  writeText(join(dir, "packages/cli/package.json"), JSON.stringify({ name: "@nexodigital/nexo", version }));
  writeText(join(dir, "packages/cli/src/bin.ts"), "console.log('cli');");
  writeFileSync(join(dir, "packages/cli/src/raw.bin"), Buffer.from([0, 1, 2, 255])); // no newline added to bytes
  writeText(join(dir, "README.md"), "outside the CLI");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

const probeOk = (version: string) => () => version;

test("installs the committed CLI only, writes the launcher and remembers the source", async () => {
  const root = await freshEnv();
  const src = checkout();
  writeText(join(src, "packages/cli/src/wip.ts"), "uncommitted"); // never copied
  writeText(join(src, "packages/cli/src/bin.ts"), "changed but not committed");
  const bin = join(tempDir(), "bin", "nexo");
  const { state, changed, files } = selfUpdate({ root, source: src, ref: "main", launcher: bin, probe: probeOk("1.2.3"), platform: "linux" });
  assert.equal(changed, true);
  assert.equal(files, 3);
  assert.match(state.dir, /os[\\/]runtime[\\/]cli[\\/]1\.2\.3-[0-9a-f]{7}$/);
  assert.equal(readFileSync(join(state.dir, "src/bin.ts"), "utf8"), "console.log('cli');\n");
  assert.deepEqual([...readFileSync(join(state.dir, "src/raw.bin"))], [0, 1, 2, 255]);
  assert.equal(existsSync(join(state.dir, "src/wip.ts")), false);
  assert.equal(existsSync(join(state.dir, "README.md")), false);
  assert.match(readFileSync(bin, "utf8"), new RegExp(LAUNCHER_MARK));
  assert.equal(readCliState(root)?.commit, git(src, "rev-parse", "HEAD"));

  // A second run on the same commit copies nothing; the command reuses the remembered source.
  const out = selfUpdateCommand({ root, bin }, undefined, probeOk("1.2.3"));
  assert.match(out, /Already on main/);
});

test("a tag installs that commit; old copies are pruned to the last two", async () => {
  const root = await freshEnv();
  const src = checkout("1.0.0");
  const bin = join(tempDir(), "nexo");
  for (const v of ["1.0.1", "1.0.2", "1.0.3"]) {
    writeText(join(src, "packages/cli/package.json"), JSON.stringify({ name: "@nexodigital/nexo", version: v }));
    git(src, "commit", "-qam", v);
    git(src, "tag", `v${v}`);
    selfUpdate({ root, source: src, ref: `v${v}`, launcher: bin, probe: probeOk(v), platform: "linux" });
  }
  selfUpdate({ root, source: src, ref: "v1.0.1", launcher: bin, probe: probeOk("1.0.1"), platform: "linux" });
  const kept = readdirSync(join(root, "os/runtime/cli")).sort();
  assert.equal(kept.length, 3);
  assert.equal(readCliState(root)?.version, "1.0.1");
});

test("refuses a foreign launcher, a bad ref, a non-Nexo package and a copy that does not start", async () => {
  const root = await freshEnv();
  const src = checkout();
  const foreign = join(tempDir(), "nexo");
  writeText(foreign, "#!/bin/sh\nexec node /usr/lib/node_modules/@nexodigital/nexo/dist/bin.js \"$@\"");
  assert.equal(ownLauncher(foreign), false);
  assert.throws(() => selfUpdate({ root, source: src, ref: "main", launcher: foreign, probe: probeOk("1.2.3") }), /not a launcher Nexo wrote/);
  const bin = join(tempDir(), "nexo");
  assert.throws(() => selfUpdate({ root, source: src, ref: "--upload-pack=x", launcher: bin }), /not a branch/);
  assert.throws(() => selfUpdate({ root, source: src, ref: "nope", launcher: bin }), /failed/);
  assert.throws(() => selfUpdate({ root, source: src, ref: "main", launcher: bin, probe: () => "9.9.9" }), /expected 1\.2\.3/);
  assert.equal(existsSync(join(root, "os/runtime/cli")) && readdirSync(join(root, "os/runtime/cli")).length, 0, "a failed copy leaves nothing behind");
  writeText(join(src, "packages/cli/package.json"), JSON.stringify({ name: "other", version: "1.0.0" }));
  git(src, "commit", "-qam", "rename");
  assert.throws(() => selfUpdate({ root, source: src, ref: "main", launcher: bin }), /not @nexodigital\/nexo/);
  assert.throws(() => selfUpdateCommand({ root }), /Usage: nexo self-update/);
});

test("launcher text: quoted for sh, a .cmd on Windows", () => {
  assert.match(launcherText("/a b/it's/bin.ts", "linux", "/usr/bin/node"), /exec '\/usr\/bin\/node' '\/a b\/it'\\''s\/bin\.ts' "\$@"/);
  assert.match(launcherText("C:\\x\\bin.ts", "win32"), /\nnode "C:\\x\\bin\.ts" %\*/);
  assert.match(launcherText("/x/bin.ts", "linux"), /exec 'node' '\/x\/bin\.ts'/);
});

test("the command takes --from/--ref/--bin, reports a new commit and refuses a folder with no Nexo CLI", async () => {
  const root = await freshEnv();
  const src = checkout("2.0.0");
  const bin = join(tempDir(), "nexo");
  assert.match(selfUpdateCommand({ root, from: src, ref: "main", bin }, undefined, probeOk("2.0.0")), /Installed nexo 2\.0\.0 from main \([0-9a-f]{7}\), 3 files/);
  const empty = tempDir();
  git(empty, "init", "-q", "-b", "main");
  writeText(join(empty, "x.txt"), "x");
  git(empty, "add", "-A");
  git(empty, "commit", "-qm", "x");
  assert.throws(() => selfUpdateCommand({ root, from: empty, bin }), /not a Nexo checkout/);
  assert.equal(defaultLauncher("win32", "/h").endsWith("nexo.cmd"), true);
  assert.equal(defaultLauncher("linux", "/h"), join("/h", ".local", "bin", "nexo"));
});
