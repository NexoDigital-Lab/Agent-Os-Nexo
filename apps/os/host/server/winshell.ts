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
