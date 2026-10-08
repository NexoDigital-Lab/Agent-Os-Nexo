// Windows .cmd shims read from disk: what they run, resolved next to them; nothing for a file that isn't there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import { CMD_META, cmdShimTargets } from "../server/winshell.ts";

test("cmdShimTargets reads a real shim file and resolves %~dp0 and %dp0% paths", () => {
  const dir = tempDir();
  const file = join(dir, "tool.cmd");
  writeFileSync(file, '@echo off\r\n"%~dp0..\\Code.exe" "%dp0%\\node_modules\\x\\bin.js" %*\r\n');
  const base = win32.dirname(file);
  assert.deepEqual(cmdShimTargets(file), [win32.resolve(base, "..\\Code.exe"), win32.resolve(base, "node_modules\\x\\bin.js")]);
  assert.deepEqual(cmdShimTargets(join(dir, "missing.cmd")), []);
});

test("CMD_META flags what cmd.exe would act on", () => {
  for (const bad of ["a&b", "a|b", "a>b", "a^b", "%PATH%", "!x!", 'a"b', "a\nb"]) assert.ok(CMD_META.test(bad), bad);
  for (const ok of ["C:\\a b\\c.ts", "nexo", "--root", "Cliente activo"]) assert.ok(!CMD_META.test(ok), ok);
});
