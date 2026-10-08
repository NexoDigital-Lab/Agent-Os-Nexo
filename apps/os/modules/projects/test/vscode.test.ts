// The VS Code helpers with a fake `code` binary and an injected launcher: nothing opens a real editor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";
import { codeRun, installExtension, installed, isEditorOnly, openInEditor, resolveCodeBin, VSCODE_ID, vscodeExec } from "../server/vscode.ts";

const skip = process.platform === "win32" ? "the fake code is a unix script" : false;

/** A `code` that lists two extensions (and counts its calls) or fails installs when FAKE_CODE_FAIL is set. */
function fakeCode() {
  const dir = tempDir("agent-os-nexo-code-");
  const bin = join(dir, "code");
  const log = join(dir, "log");
  writeFileSync(bin, `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "--list-extensions") console.log("Foo.Bar\\n\\nbaz.qux");
else if (process.env.FAKE_CODE_FAIL) (process.stderr.write("marketplace down\\n"), process.exit(1));
`);
  chmodSync(bin, 0o755);
  return { bin, calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean) };
}

test("extension ids: marketplace shape, and agent-os-nexo.* belongs to our own editor", () => {
  assert.ok(VSCODE_ID.test("ms-python.python"));
  assert.ok(!VSCODE_ID.test("nodots"));
  assert.ok(!VSCODE_ID.test("a b.c"));
  assert.ok(isEditorOnly("agent-os-nexo.theme"));
  assert.ok(!isEditorOnly("ms.agent-os-nexo"));
});

/** Sets an env var for the test and restores the previous value (or absence) afterwards. */
function withEnv(name: string, value: string | undefined, fn: () => void) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

test("resolveCodeBin on win32 searches code.cmd in the Windows install dirs", () => {
  withEnv("LOCALAPPDATA", "C:/Users/u/AppData/Local", () =>
    withEnv("ProgramFiles", "C:/Program Files", () =>
      withEnv("ProgramFiles(x86)", undefined, () => {
        const dirs = [join("C:/Users/u/AppData/Local", "Programs", "Microsoft VS Code", "bin"), join("C:/Program Files", "Microsoft VS Code", "bin")];
        const calls: [string, string[]][] = [];
        const fakeFind = (name: string, found: string[] = []) => {
          calls.push([name, found]);
          return name === "code.cmd" && found[0]!.includes("AppData") ? "C:/Users/u/…/bin/code.cmd" : null;
        };
        assert.equal(resolveCodeBin("win32", fakeFind), "C:/Users/u/…/bin/code.cmd");
        assert.deepEqual(calls, [["code.cmd", dirs]], "stops at the first hit");
        // When code.cmd is absent it tries plain `code` in the same dirs.
        calls.length = 0;
        assert.equal(
          resolveCodeBin("win32", (name, found = []) => (calls.push([name, found]), name === "code" ? "C:/bin/code" : null)),
          "C:/bin/code",
        );
        assert.deepEqual(calls.map((c) => c[0]), ["code.cmd", "code"]);
      }),
    ),
  );
});

test("resolveCodeBin on win32 falls back to code.cmd when nothing is found", () => {
  withEnv("LOCALAPPDATA", undefined, () =>
    withEnv("ProgramFiles", undefined, () =>
      withEnv("ProgramFiles(x86)", undefined, () => {
        assert.equal(resolveCodeBin("win32", () => null), "code.cmd");
      }),
    ),
  );
});

test("resolveCodeBin on POSIX keeps the flatpak chain", () => {
  const flatpak = ["/var/lib/flatpak/exports/bin"];
  const seen: string[] = [];
  assert.equal(
    resolveCodeBin("linux", (name, dirs = []) => (seen.push(`${name}:${dirs.join(",")}`), name === "code" ? "/flatpak/code" : null)),
    "/flatpak/code",
  );
  assert.deepEqual(seen, [`code:${flatpak}`]);
  assert.equal(
    resolveCodeBin("linux", (name) => (name === "com.visualstudio.code" ? "/flatpak/com.visualstudio.code" : null)),
    "/flatpak/com.visualstudio.code",
  );
  assert.equal(resolveCodeBin("linux", () => null), "code");
});

test("codeRun routes a .cmd bin through cmd.exe /c, a plain bin directly", async () => {
  const real = vscodeExec.run;
  const calls: { cmd: string; args: string[] }[] = [];
  vscodeExec.run = (async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { stdout: "x" };
  }) as never;
  try {
    assert.deepEqual(await codeRun("foo.cmd", ["--list-extensions"], { timeout: 5 }), { stdout: "x" });
    const comspec = process.env.ComSpec ?? "cmd.exe";
    assert.deepEqual(calls, [{ cmd: comspec, args: ["/c", "foo.cmd", "--list-extensions"] }]);
    calls.length = 0;
    assert.deepEqual(await codeRun("code", ["--list-extensions"]), { stdout: "x" });
    assert.deepEqual(calls, [{ cmd: "code", args: ["--list-extensions"] }]);
  } finally {
    vscodeExec.run = real;
  }
});

test("no code binary means no installed list (null), cached for a moment", async () => {
  assert.equal(await installed(join(tempDir(), "missing-code")), null);
});

test("installed lists lower-cased ids and caches them until an install resets it", { skip }, async () => {
  const fake = fakeCode();
  await installExtension("pub.reset", fake.bin); // clears the cache left by the previous test
  const first = await installed(fake.bin);
  assert.deepEqual([...first!], ["foo.bar", "baz.qux"]);
  await installed(fake.bin);
  assert.equal(fake.calls().filter((c) => c === "--list-extensions").length, 1, "second call served from the cache");
  await installExtension("pub.again", fake.bin);
  await installed(fake.bin);
  assert.equal(fake.calls().filter((c) => c === "--list-extensions").length, 2, "an install drops the cache");
});

test("installExtension runs code --install-extension and answers ok", { skip }, async () => {
  const fake = fakeCode();
  assert.deepEqual(await installExtension("ms-python.python", fake.bin), { ok: true });
  assert.deepEqual(fake.calls(), ["--install-extension ms-python.python"]);
});

test("installExtension rejects bad and editor-only ids before running anything", async () => {
  for (const id of ["nope", "agent-os-nexo.theme", "x y.z"]) {
    await assert.rejects(installExtension(id, join(tempDir(), "never-run")), (e: any) => e.status === 400 && /Invalid extension id/.test(e.message));
  }
});

test("a failing install is a 500 carrying code's stderr", { skip }, async () => {
  const fake = fakeCode();
  process.env.FAKE_CODE_FAIL = "1";
  try {
    await assert.rejects(installExtension("pub.ext", fake.bin), (e: any) => e.status === 500 && /code --install-extension failed: marketplace down/.test(e.message));
  } finally {
    delete process.env.FAKE_CODE_FAIL;
  }
  await assert.rejects(installExtension("pub.ext", join(tempDir(), "absent")), (e: any) => e.status === 500 && /failed: /.test(e.message));
});

function launcher() {
  const launched: Array<{ cmd: string; args: string[] }> = [];
  const children: EventEmitter[] = [];
  const launch = ((cmd: string, args: string[]) => {
    launched.push({ cmd, args });
    const child = Object.assign(new EventEmitter(), { unref() {} });
    children.push(child);
    return child;
  }) as never;
  return { launch, launched, children };
}

test("openInEditor opens the project folder, detached", () => {
  const root = tempDir();
  const l = launcher();
  openInEditor(root, undefined, undefined, l.launch, "code-bin");
  assert.deepEqual(l.launched, [{ cmd: "code-bin", args: [root] }]);
});

test("openInEditor opens one file with -g and the line", () => {
  const root = tempDir();
  writeFileSync(join(root, "a.ts"), "");
  const l = launcher();
  openInEditor(root, "a.ts", 12, l.launch, "code-bin");
  openInEditor(root, "a.ts", undefined, l.launch, "code-bin");
  assert.deepEqual(l.launched.map((x) => x.args), [["-g", `${join(root, "a.ts")}:12`], ["-g", join(root, "a.ts")]]);
});

test("openInEditor refuses a file outside the project and never launches", () => {
  const root = tempDir();
  const l = launcher();
  assert.throws(() => openInEditor(root, "../outside", 1, l.launch, "code-bin"), /Path outside the project/);
  assert.equal(l.launched.length, 0);
});

test("when code cannot start, the desktop default is tried", () => {
  const root = tempDir();
  mkdirSync(join(root, "d"));
  const l = launcher();
  openInEditor(root, "d", undefined, l.launch, "code-bin");
  // The fallback's own child must be unref'able too. Windows opens the target through cmd.exe, not xdg-open.
  l.children[0]!.emit("error", new Error("ENOENT"));
  const comspec = process.env.ComSpec ?? "cmd.exe";
  const fallback = (target: string) =>
    process.platform === "win32" ? { cmd: comspec, args: ["/c", "start", "", target] } : { cmd: "xdg-open", args: [target] };
  assert.deepEqual(l.launched[1], fallback(join(root, "d")));
  const l2 = launcher();
  openInEditor(root, undefined, undefined, l2.launch, "code-bin");
  l2.children[0]!.emit("error", new Error("ENOENT"));
  assert.deepEqual(l2.launched[1], fallback(root));
});

test("openInEditor launches a .cmd bin through cmd.exe /c start with no error listener", () => {
  const root = tempDir();
  const l = launcher();
  openInEditor(root, undefined, undefined, l.launch, "C:/VS Code/bin/code.cmd");
  const comspec = process.env.ComSpec ?? "cmd.exe";
  assert.deepEqual(l.launched, [{ cmd: comspec, args: ["/c", "start", "", "C:/VS Code/bin/code.cmd", root] }]);
  assert.equal(l.children[0]!.listeners("error").length, 0);
});

test("openInEditor does not follow a symlink out of the project", { skip }, () => {
  const root = tempDir();
  const outside = tempDir();
  symlinkSync(outside, join(root, "link"));
  assert.throws(() => openInEditor(root, "link", undefined, launcher().launch, "code-bin"), /symlink/);
});
