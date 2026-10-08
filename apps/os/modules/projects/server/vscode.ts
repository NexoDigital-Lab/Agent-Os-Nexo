// VS Code's CLI: list/install extensions and open a project or file in it.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, win32 } from "node:path";
import { findBin, httpError, run } from "../../../host/server/http.ts";
import { safePath } from "./repo.ts";
import { CMD_META, cmdShimTargets } from "../../../host/server/winshell.ts";

/** VS Code's CLI per platform: Windows ships `code.cmd` (codeCliOf runs what it runs, without cmd.exe). */
export function resolveCodeBin(platform = process.platform, find: typeof findBin = findBin): string {
  if (platform === "win32") {
    const dirs = [
      ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "bin")] : []),
      ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
        .filter((d): d is string => !!d)
        .map((d) => join(d, "Microsoft VS Code", "bin")),
    ];
    return find("code.cmd", dirs) ?? find("code", dirs) ?? "code.cmd";
  }
  return find("code", ["/var/lib/flatpak/exports/bin"]) ?? find("com.visualstudio.code", ["/var/lib/flatpak/exports/bin"]) ?? "code";
}

const CODE_BIN = resolveCodeBin();

/** The process launcher; tests swap `run` for a fake so no real code runs. */
export const vscodeExec: { run: typeof run } = { run };

/**
 * What `code.cmd` runs — `Code.exe …\resources\app\out\cli.js` with ELECTRON_RUN_AS_NODE=1 — read from the shim (else
 * the standard layout next to it), so VS Code's CLI runs without cmd.exe. Null when those files are not there.
 */
export function codeCliOf(bin: string, read?: (f: string) => string, exists: (f: string) => boolean = existsSync): { file: string; pre: string[] } | null {
  const targets = cmdShimTargets(bin, read);
  const root = win32.dirname(win32.dirname(bin));
  const exe = targets.find((t) => /\.exe$/i.test(t)) ?? win32.join(root, "Code.exe");
  const cli = targets.find((t) => /\.js$/i.test(t)) ?? win32.join(root, "resources", "app", "out", "cli.js");
  return exists(exe) && exists(cli) ? { file: exe, pre: [cli] } : null;
}

const asNode = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: "1" });
const unsafeForCmd = () =>
  httpError(400, "This path or value has characters the Windows command line would run (& | < > ^ % ! \"), and VS Code's own CLI was not found to run it safely.");

/**
 * Runs the VS Code CLI. A `.cmd` bin runs the way the shim would, Code.exe + cli.js, with no shell; only when those
 * files can't be found does it go through `cmd.exe /c`, and then never with an argument cmd.exe would interpret.
 */
export function codeRun(bin: string, args: string[], opts: { timeout?: number } = {}, cli = codeCliOf): Promise<{ stdout: string }> {
  if (!/\.(cmd|bat)$/i.test(bin)) return vscodeExec.run(bin, args, opts);
  const how = cli(bin);
  if (how) return vscodeExec.run(how.file, [...how.pre, ...args], { ...opts, env: asNode() });
  if (args.some((a) => CMD_META.test(a))) return Promise.reject(unsafeForCmd());
  return vscodeExec.run(process.env.ComSpec ?? "cmd.exe", ["/c", bin, ...args], opts);
}

/** A Marketplace id: publisher.name. */
export const VSCODE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** "agent-os-nexo.*" ids exist only in agent-os-nexo's own editor, never in VS Code. */
export const isEditorOnly = (id: string) => id.startsWith("agent-os-nexo.");

let installedCache: { at: number; ids: Set<string> | null } | null = null;
export async function installed(bin = CODE_BIN): Promise<Set<string> | null> {
  if (installedCache && Date.now() - installedCache.at < 20_000) return installedCache.ids;
  const ids = await codeRun(bin, ["--list-extensions"], { timeout: 20_000 }).then(
    (r) => new Set(r.stdout.split("\n").filter(Boolean).map((s) => s.toLowerCase())),
    () => null, // no `code` on PATH
  );
  installedCache = { at: Date.now(), ids };
  return ids;
}

export async function installExtension(id: string, bin = CODE_BIN) {
  if (!VSCODE_ID.test(id) || isEditorOnly(id)) throw httpError(400, "Invalid extension id");
  try {
    await codeRun(bin, ["--install-extension", id], { timeout: 180_000 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw httpError(500, `code --install-extension failed: ${(e.stderr || e.message).trim()}`);
  }
  installedCache = null;
  return { ok: true };
}

/**
 * Opens the project (or one file at a line) in VS Code. If VS Code can't start, the desktop shows the file — never
 * runs it: xdg-open, or on Windows Explorer with it selected (`start <file>` would execute a .bat or an .exe).
 */
export function openInEditor(
  root: string, rel?: string, line?: number, launch: typeof spawn = spawn, bin = CODE_BIN, platform = process.platform, cli = codeCliOf,
) {
  const target = rel ? `${safePath(root, rel)}${line ? `:${line}` : ""}` : root;
  const args = rel ? ["-g", target] : [root];
  const reveal = () => {
    const path = rel ? safePath(root, rel) : root;
    const [cmd, cmdArgs] = platform === "win32" ? ["explorer.exe", rel ? [`/select,${path}`] : [path]] : ["xdg-open", [path]];
    launch(cmd, cmdArgs, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  };
  let child: ReturnType<typeof spawn>;
  if (/\.(cmd|bat)$/i.test(bin)) {
    const how = cli(bin);
    if (!how) {
      if (args.some((a) => CMD_META.test(a))) throw unsafeForCmd();
      // cmd.exe /c start returns at once and owns the window: there is no error to listen for.
      launch(process.env.ComSpec ?? "cmd.exe", ["/c", "start", "", bin, ...args], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      return;
    }
    child = launch(how.file, [...how.pre, ...args], { detached: true, stdio: "ignore", windowsHide: true, env: asNode() });
  } else {
    child = launch(bin, args, { detached: true, stdio: "ignore" });
  }
  child.on("error", reveal);
  child.unref();
}
