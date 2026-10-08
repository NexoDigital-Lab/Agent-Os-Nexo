// Windows `.cmd` shims (npm's `nexo.cmd`, VS Code's `code.cmd`): read what they run, so it runs without cmd.exe.
// cmd.exe parses & | < > ^ % ! " inside arguments, so a file name from a cloned repo or a dictionary term could run
// commands (the BatBadBut class, CVE-2024-27980) — Node refuses to spawn a .cmd without a shell for that reason.
import { readFileSync } from "node:fs";
import { win32 } from "node:path";

/** Characters cmd.exe acts on inside arguments: a value carrying one must never reach it. */
export const CMD_META = /[&|<>^%!"\r\n]/;

/** The absolute paths a shim refers to as `"%~dp0…"` / `"%dp0%\…"`, in order. Empty when it can't be read. */
export function cmdShimTargets(cmdFile: string, read: (f: string) => string = (f) => readFileSync(f, "utf8")): string[] {
  let text: string;
  try {
    text = read(cmdFile);
  } catch {
    return [];
  }
  const dir = win32.dirname(cmdFile);
  return [...text.matchAll(/"%(?:~dp0|dp0)%?\\?([^"%]+)"/gi)].map((m) => win32.resolve(dir, m[1] ?? ""));
}

/**
 * npm's shim only runs `node "%dp0%\…\cli.js" %*`: that script, so the tool runs with node directly and no argument
 * ever goes through cmd.exe. Null when the shim is not npm's.
 */
export function shimScript(cmdFile: string, read?: (f: string) => string): string | null {
  return cmdShimTargets(cmdFile, read).find((t) => /\.(c|m)?js$/i.test(t)) ?? null;
}

/**
 * How to run a binary found on PATH: as it is; an npm `.cmd` shim as node + its script; any other shim through cmd.exe,
 * flagged `viaCmd` — the caller must then refuse every argument CMD_META matches.
 */
export function launcher(bin: string, script: (cmdFile: string) => string | null = shimScript): { cmd: string; pre: string[]; viaCmd: boolean } {
  if (!/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, pre: [], viaCmd: false };
  const js = script(bin);
  if (js) return { cmd: process.execPath, pre: [js], viaCmd: false };
  return { cmd: process.env.ComSpec ?? "cmd.exe", pre: ["/c", bin], viaCmd: true };
}
