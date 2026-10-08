// The factory hooks' behavior: block-force-push must catch every way of overwriting remote history.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error — a plain .mjs factory script, no types
import { isForcePush } from "../nexo_bases/library/hooks/scripts/block-force-push.mjs";

const F = ["--", "force"].join(""); // spelled apart so this file never trips the hook itself

test("block-force-push: every force form is caught, wherever git's own options go", () => {
  for (const c of [
    `git push ${F}`,
    `git push origin main ${F}`,
    `git push ${F}-with-lease`,
    `git push ${F}-with-lease=main:abc origin main`,
    "git push -f",
    "git push -uf origin x",
    "git push origin +main",
    "git push origin +HEAD:main",
    "git push --mirror backup",
    "git -C repo push -f",
    "git -c user.name=x push origin main -f",
    "/usr/bin/git push -f",
    "cd repo && git push origin +main",
    `echo hi; git push ${F}`,
  ]) {
    assert.equal(isForcePush(c), true, c);
  }
});

test("block-force-push: ordinary pushes and other commands pass", () => {
  for (const c of [
    "git push",
    "git push origin main",
    "git push -u origin feature/fix",
    "git push --tags",
    "git push origin feature-f",
    "git fetch -f",
    "git status && git log -f",
    "npm run push -- -f",
    "echo git",
    'git commit -m "push -f to main"',
    "git log --grep push -f",
  ]) {
    assert.equal(isForcePush(c), false, c);
  }
});

test("block-force-push: as a hook it exits 2 for a force push from the JSON payload, 0 otherwise", () => {
  const script = fileURLToPath(new URL("../nexo_bases/library/hooks/scripts/block-force-push.mjs", import.meta.url));
  const run = (command: string) => spawnSync(process.execPath, [script], { input: JSON.stringify({ tool_input: { command } }) }).status;
  assert.equal(run("git -C x push -f"), 2);
  assert.equal(run("git push origin main"), 0);
});
