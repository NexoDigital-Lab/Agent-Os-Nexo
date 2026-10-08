import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

/** What to spawn for a command: the file, its arguments, and whether they are already quoted for cmd.exe. */
export interface Spawnable {
  file: string;
  args: string[];
  verbatim: boolean;
}

/** Package managers that Windows installs as `.cmd` shims, which Node refuses to spawn without a shell. */
const WINDOWS_SHIMS = new Set(["npm", "npx", "yarn", "pnpm", "corepack"]);

/** cmd.exe metacharacters, escaped with `^` so a quoted argument reaches the program as one piece. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Quotes one argument for a `.cmd` shim run by `cmd.exe /d /s /c` (the shim parses it again, so it is escaped twice). */
export function quoteForCmd(arg: string): string {
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  quoted = `"${quoted}"`;
  return quoted.replace(CMD_META, "^$1").replace(CMD_META, "^$1");
}

/**
 * How to start `cmd` without a shell re-splitting its arguments. Everywhere but Windows, and for real executables,
 * that is the command itself. On Windows, npm and npx run as `node <their cli.js>` (no shell at all); the other
 * shims go through `cmd.exe` with every argument quoted, so a path with spaces stays one argument.
 */
export function spawnable(
  cmd: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
  exists: (path: string) => boolean = existsSync,
): Spawnable {
  if (platform !== "win32" || !WINDOWS_SHIMS.has(cmd)) return { file: cmd, args, verbatim: false };
  if (cmd === "npm" || cmd === "npx") {
    const cli = win32.join(win32.dirname(execPath), "node_modules", "npm", "bin", `${cmd}-cli.js`);
    if (exists(cli)) return { file: execPath, args: [cli, ...args], verbatim: false };
  }
  const line = [`${cmd}.cmd`.replace(CMD_META, "^$1"), ...args.map(quoteForCmd)].join(" ");
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

/** Runs a command and returns its trimmed stdout (stderr when stdout is empty), or null when it fails or is missing. */
export function tryRun(cmd: string, args: string[], timeoutMs = 5000): string | null {
  const s = spawnable(cmd, args);
  const r = spawnSync(s.file, s.args, {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    windowsVerbatimArguments: s.verbatim,
    windowsHide: true,
  });
  // Some tools (java -version) print only to stderr: a success with nothing on stdout returns that.
  if (!r.error && r.status === 0) return r.stdout.trim() || r.stderr.trim();
  return null;
}

export function gitConfig(key: string): string {
  return tryRun("git", ["config", "--get", key]) ?? "";
}

/** True when `bin` is an executable on PATH (with Windows' .cmd/.exe/.bat forms). */
export function onPath(bin: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): boolean {
  const sep = platform === "win32" ? ";" : ":";
  const join = platform === "win32" ? win32.join : (a: string, b: string) => `${a.replace(/\/+$/, "")}/${b}`;
  const names = platform === "win32" ? [`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`, bin] : [bin];
  return String(env.PATH ?? env.Path ?? "").split(sep).filter(Boolean).some((dir) => names.some((n) => exists(join(dir, n))));
}
