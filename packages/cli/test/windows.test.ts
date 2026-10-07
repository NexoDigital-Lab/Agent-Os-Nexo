// Windows behavior, tested on every OS: the platform is a parameter, Windows paths come from path.win32.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";
import { quoteForCmd, spawnable, tryRun } from "../src/core/exec.ts";
import { claudePathRule } from "../src/core/permissions.ts";
import { linkDir, linksTo } from "../src/core/fsx.ts";
import { commandOf, defaultRunner, killTree } from "../src/core/osruntime.ts";
import { createDesktopShortcut, desktopFolder, findDesktopExe, psQuote, shortcutScript, type ShortcutDeps } from "../src/core/desktopShortcut.ts";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const NPM_CLI = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

test("exec: commands spawn as themselves outside Windows, and real executables on Windows too", () => {
  assert.deepEqual(spawnable("npm", ["install"], "linux"), { file: "npm", args: ["install"], verbatim: false });
  assert.deepEqual(spawnable("npm", ["install"], "darwin"), { file: "npm", args: ["install"], verbatim: false });
  assert.deepEqual(spawnable("git", ["status"], "win32"), { file: "git", args: ["status"], verbatim: false });
});

test("exec: npm and npx on Windows run as node <cli.js>, so no shell splits a path with spaces", () => {
  const tmp = "C:\\Users\\Eros Benitez\\AppData\\Local\\Temp\\nexo-os-1";
  const npm = spawnable("npm", ["pack", "x", "--pack-destination", tmp], "win32", NODE, (p) => p === NPM_CLI);
  assert.deepEqual(npm, { file: NODE, args: [NPM_CLI, "pack", "x", "--pack-destination", tmp], verbatim: false });
  const npx = spawnable("npx", ["tsc"], "win32", NODE, () => true);
  assert.equal(npx.args[0], "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js");
});

test("exec: other Windows shims (and npm without its cli.js) go through cmd.exe with every argument quoted", () => {
  const pnpm = spawnable("pnpm", ["--dir", "C:\\a b"], "win32", NODE, () => false);
  assert.deepEqual(pnpm, { file: "cmd.exe", args: ["/d", "/s", "/c", '"pnpm.cmd ^^^"--dir^^^" ^^^"C:\\a^^^ b^^^""'], verbatim: true });
  assert.equal(spawnable("npm", ["-v"], "win32", NODE, () => false).file, "cmd.exe");
});

test("exec: quoteForCmd keeps an argument whole through cmd.exe and a .cmd shim", () => {
  assert.equal(quoteForCmd("plain"), '^^^"plain^^^"');
  assert.equal(quoteForCmd("a&b|c"), '^^^"a^^^&b^^^|c^^^"');
  assert.equal(quoteForCmd('say "hi"'), '^^^"say^^^ \\^^^"hi\\^^^"^^^"');
  assert.equal(quoteForCmd("C:\\dir\\"), '^^^"C:\\dir\\\\^^^"', "a trailing backslash must not escape the closing quote");
  assert.equal(quoteForCmd("%PATH%"), '^^^"^^^%PATH^^^%^^^"');
});

test("exec: tryRun returns stdout, and null for a failing or missing command", () => {
  assert.equal(tryRun(process.execPath, ["-e", "console.log(' ok ')"]), "ok");
  assert.equal(tryRun(process.execPath, ["-e", "process.exit(3)"]), null);
  assert.equal(tryRun(process.execPath, ["-e", "console.error('version 1.2.3')"]), "version 1.2.3", "like java -version: only stderr");
  assert.equal(tryRun(process.execPath, ["-e", "console.error('bad'); process.exit(1)"]), null);
  assert.equal(tryRun("nexo-no-such-command", []), null);
  assert.equal(tryRun(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], 200), null, "a timeout is a failure");
});

test("exec: the default runner passes arguments with spaces intact and reports failures", () => {
  const dir = tempDir();
  const out = join(dir, "with space", "out.txt");
  mkdirSync(join(dir, "with space"));
  defaultRunner(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1], 'x')", out], dir);
  assert.equal(lstatSync(out).size, 1);
  assert.throws(() => defaultRunner(process.execPath, ["-e", "process.exit(2)"], dir), /failed \(exit 2\)/);
  assert.throws(() => defaultRunner("nexo-no-such-command", [], dir), /could not start/);
});

test("permissions: Claude rules use POSIX paths, a Windows drive becomes //c/", () => {
  assert.equal(claudePathRule("Read", "/env", "secrets/**"), "Read(//env/secrets/**)");
  assert.equal(claudePathRule("Edit", "C:\\Users\\me\\env", "projects/**/code/**"), "Edit(//c/Users/me/env/projects/**/code/**)");
  assert.equal(claudePathRule("Read", "D:\\env", "secrets\\**"), "Read(//d/env/secrets/**)");
});

test("links: linkDir makes a folder link that linksTo recognizes, relative or absolute", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "library", "skills"), { recursive: true });
  mkdirSync(join(dir, "other"));
  mkdirSync(join(dir, ".claude"));
  const link = join(dir, ".claude", "skills");
  linkDir(join("..", "library", "skills"), link);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.ok(linksTo(link, join("..", "library", "skills")));
  assert.ok(linksTo(link, join(dir, "library", "skills")), "the same target, written absolute");
  assert.ok(!linksTo(link, join("..", "other")));
  // On Windows a junction; elsewhere the type is ignored and it is a symlink.
  const junction = join(dir, "junction");
  linkDir(join(dir, "other"), junction, "win32");
  assert.ok(linksTo(junction, join(dir, "other")));
});

test("processes: commandOf reads a live process's command line, null for a dead one", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    // WMI through PowerShell can be slow on loaded CI runners: re-read a few times before asserting.
    let line = "";
    for (let i = 0; i < 3 && !/setTimeout/.test(line); i++) {
      line = commandOf(child.pid!) ?? "";
      if (!/setTimeout/.test(line)) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.match(line, /setTimeout/);
    // Windows asks WMI through PowerShell; where there is no PowerShell the answer is empty, never a crash.
    if (process.platform !== "win32") assert.equal(typeof commandOf(child.pid!, "win32"), "string");
  } finally {
    child.kill();
  }
  await new Promise((r) => child.once("exit", r));
  assert.equal(commandOf(child.pid!), null);
});

test("processes: killTree ends a detached process and its group, and falls back to the process itself", async () => {
  const exited = (c: ReturnType<typeof spawn>) => new Promise((r) => c.once("exit", r));
  const group = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore", detached: true });
  const groupDone = exited(group);
  killTree(group.pid!);
  await groupDone;
  // The Windows branch: taskkill first; where it is missing, the process itself is signalled.
  const plain = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  const plainDone = exited(plain);
  killTree(plain.pid!, "win32");
  await plainDone;
  assert.doesNotThrow(() => killTree(plain.pid!), "an ended process is ignored quietly");
});

/** A fake Windows: these files exist, PowerShell answers with `desktop` (or fails when null). */
function fakeWindows(files: string[], desktop: string | null, env: Record<string, string> = {}): ShortcutDeps & { scripts: string[] } {
  const scripts: string[] = [];
  const present = new Set(files);
  return {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", ProgramFiles: "C:\\Program Files", USERPROFILE: "C:\\Users\\me", ...env },
    exists: (p) => present.has(p),
    powershell: (script) => {
      scripts.push(script);
      if (script.includes("GetFolderPath")) return desktop;
      if (desktop === null) return null;
      present.add(/CreateShortcut\('([^']+)'\)/.exec(script)![1]!);
      return "";
    },
    scripts,
  };
}

const REPO = "C:\\src\\Agent-Os-Nexo";
const USER_EXE = "C:\\Users\\me\\AppData\\Local\\agent-os-nexo\\agent-os-nexo.exe";
const MACHINE_EXE = "C:\\Program Files\\agent-os-nexo\\agent-os-nexo-desktop.exe";
const DEV_EXE = "C:\\src\\Agent-Os-Nexo\\apps\\desktop\\src-tauri\\target\\release\\agent-os-nexo-desktop.exe";

test("shortcut: the installed app comes first (per user, then per machine), then a build in the repository", () => {
  assert.equal(findDesktopExe(REPO, fakeWindows([USER_EXE, MACHINE_EXE, DEV_EXE], null)), USER_EXE);
  assert.equal(findDesktopExe(REPO, fakeWindows([MACHINE_EXE, DEV_EXE], null)), MACHINE_EXE);
  assert.equal(findDesktopExe(REPO, fakeWindows([DEV_EXE], null)), DEV_EXE);
  assert.equal(findDesktopExe(REPO, fakeWindows([], null)), null);
  assert.equal(findDesktopExe(REPO, { ...fakeWindows([DEV_EXE], null), env: {} }), DEV_EXE, "no install folders known");
});

test("shortcut: the desktop is the one Windows reports, else %USERPROFILE%\\Desktop when it exists", () => {
  assert.equal(desktopFolder(fakeWindows([], "D:\\OneDrive\\Desktop")), "D:\\OneDrive\\Desktop");
  assert.equal(desktopFolder(fakeWindows(["C:\\Users\\me\\Desktop"], null)), "C:\\Users\\me\\Desktop");
  assert.equal(desktopFolder(fakeWindows([], null)), null);
  assert.equal(desktopFolder({ ...fakeWindows([], null), env: {} }), null);
});

test("shortcut: the script quotes every path, so a quote in a folder name cannot break out", () => {
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(psQuote("O\u2019Brien"), "'O\u2019\u2019Brien'", "PowerShell reads typographic quotes as quotes too");
  const script = shortcutScript("C:\\Users\\o'neil\\Desktop\\agent-os-nexo.lnk", "C:\\Users\\o'neil\\agent-os-nexo\\agent-os-nexo.exe");
  assert.match(script, /CreateShortcut\('C:\\Users\\o''neil\\Desktop\\agent-os-nexo\.lnk'\)/);
  assert.match(script, /WorkingDirectory = 'C:\\Users\\o''neil\\agent-os-nexo'/);
  assert.match(script, /IconLocation = 'C:\\Users\\o''neil\\agent-os-nexo\\agent-os-nexo\.exe,0'/);
  assert.doesNotMatch(script.replace(/'(?:[^']|'')*'/g, ""), /o.neil/, "no path outside a quoted string");
});

test("shortcut: written on Windows when there is an app and a desktop, skipped otherwise", () => {
  const win = fakeWindows([USER_EXE], "C:\\Users\\me\\Desktop");
  assert.equal(createDesktopShortcut(REPO, win), "C:\\Users\\me\\Desktop\\agent-os-nexo.lnk");
  assert.match(win.scripts.at(-1)!, /TargetPath = 'C:\\Users\\me\\AppData\\Local\\agent-os-nexo\\agent-os-nexo\.exe'/);
  assert.equal(createDesktopShortcut(REPO, { ...fakeWindows([USER_EXE], "C:\\D"), platform: "linux" }), null);
  assert.equal(createDesktopShortcut(REPO, fakeWindows([], "C:\\D")), null, "no app to point at");
  assert.equal(createDesktopShortcut(REPO, fakeWindows([USER_EXE], null)), null, "no desktop");
  const failing = fakeWindows([USER_EXE, "C:\\Users\\me\\Desktop"], null);
  assert.equal(createDesktopShortcut(REPO, failing), null, "PowerShell failed to save it");
  const unsaved = { ...fakeWindows([USER_EXE], "C:\\D"), powershell: (s: string) => (s.includes("GetFolderPath") ? "C:\\D" : "") };
  assert.equal(createDesktopShortcut(REPO, unsaved), null, "PowerShell said yes but wrote nothing");
});

test("exec: a real .cmd shim on Windows gets arguments with spaces, & and quotes intact", { skip: process.platform === "win32" ? false : "needs cmd.exe" }, () => {
  const dir = tempDir();
  writeFileSync(join(dir, "args.js"), "console.log(JSON.stringify(process.argv.slice(2)))");
  // The same shape as npm's own shims: the program, its script, then %*.
  writeFileSync(join(dir, "pnpm.cmd"), `@"${process.execPath}" "%~dp0\\args.js" %*\r\n`);
  const saved = process.env.PATH;
  try {
    process.env.PATH = `${dir};${saved}`;
    const args = ["a b", "x&y", 'say "hi"', "100%", "C:\\dir\\"];
    assert.deepEqual(JSON.parse(tryRun("pnpm", args)!), args);
  } finally {
    process.env.PATH = saved;
  }
});
