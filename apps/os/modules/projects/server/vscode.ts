// VS Code's CLI: list/install extensions and open a project or file in it.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { findBin, httpError, run } from "../../../host/server/http.ts";
import { safePath } from "./repo.ts";

/** VS Code's CLI per platform: Windows ships `code.cmd`, which only runs through cmd.exe. */
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

/** Runs the VS Code CLI. A `.cmd`/`.bat` bin needs `cmd.exe /c` (execFile on one throws EINVAL on Node 22 Windows). */
export function codeRun(bin: string, args: string[], opts: { timeout?: number } = {}): Promise<{ stdout: string }> {
  return /\.(cmd|bat)$/i.test(bin)
    ? vscodeExec.run(process.env.ComSpec ?? "cmd.exe", ["/c", bin, ...args], opts)
    : vscodeExec.run(bin, args, opts);
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

/** Opens the project (or one file at a line) in VS Code, falling back to the desktop default. */
export function openInEditor(root: string, rel?: string, line?: number, launch: typeof spawn = spawn, bin = CODE_BIN) {
  const target = rel ? `${safePath(root, rel)}${line ? `:${line}` : ""}` : root;
  const args = rel ? ["-g", target] : [root];
  if (/\.(cmd|bat)$/i.test(bin)) {
    // cmd.exe /c start returns immediately and owns the window, so there is no error listener to attach.
    launch(process.env.ComSpec ?? "cmd.exe", ["/c", "start", "", bin, ...args], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  const child = launch(bin, args, { detached: true, stdio: "ignore" });
  child.on("error", () =>
    launch(
      process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "xdg-open",
      process.platform === "win32" ? ["/c", "start", "", rel ? safePath(root, rel) : root] : [rel ? safePath(root, rel) : root],
      { detached: true, stdio: "ignore", windowsHide: true },
    ).unref(),
  );
  child.unref();
}
