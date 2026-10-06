// A Windows desktop shortcut for agent-os's desktop shell (apps/desktop), made by `nexo os install`. No-op elsewhere.
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { tryRun } from "./exec.ts";

/** What the shortcut needs from the system. Tests pass fakes. */
export interface ShortcutDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
  /** Runs a PowerShell script and returns its trimmed output, or null when it fails. */
  powershell: (script: string) => string | null;
}

const systemDeps = (): ShortcutDeps => ({
  platform: process.platform,
  env: process.env,
  exists: existsSync,
  powershell: (script) => tryRun("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 15_000),
});

/** The names the desktop shell's executable goes by: the installer's (productName) and cargo's. */
const EXE_NAMES = ["agent-os.exe", "agent-os-desktop.exe"];

/**
 * The desktop shell's executable: installed by its NSIS installer (per user in %LOCALAPPDATA%, or per machine in
 * %ProgramFiles%), else a release build in this repository (`npm run build:binary` in apps/desktop). Null if none.
 */
export function findDesktopExe(repoRoot: string, deps: ShortcutDeps): string | null {
  const installDirs = [deps.env.LOCALAPPDATA, deps.env.ProgramFiles].filter((d): d is string => !!d).map((d) => win32.join(d, "agent-os"));
  for (const dir of installDirs) {
    for (const name of EXE_NAMES) {
      const exe = win32.join(dir, name);
      if (deps.exists(exe)) return exe;
    }
  }
  const built = win32.join(repoRoot, "apps", "desktop", "src-tauri", "target", "release", "agent-os-desktop.exe");
  return deps.exists(built) ? built : null;
}

/** The user's Desktop folder, OneDrive-redirected ones included; the classic %USERPROFILE%\Desktop as a fallback. */
export function desktopFolder(deps: ShortcutDeps): string | null {
  const reported = deps.powershell("[Environment]::GetFolderPath('Desktop')");
  if (reported) return reported;
  const classic = deps.env.USERPROFILE ? win32.join(deps.env.USERPROFILE, "Desktop") : null;
  return classic && deps.exists(classic) ? classic : null;
}

/** A PowerShell single-quoted string: nothing inside is expanded, a quote is doubled. */
export const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** The script that writes `lnk` pointing at `exe`, with the icon the executable carries. */
export function shortcutScript(lnk: string, exe: string): string {
  return [
    "$ws = New-Object -ComObject WScript.Shell",
    `$l = $ws.CreateShortcut(${psQuote(lnk)})`,
    `$l.TargetPath = ${psQuote(exe)}`,
    `$l.WorkingDirectory = ${psQuote(win32.dirname(exe))}`,
    `$l.IconLocation = ${psQuote(`${exe},0`)}`,
    "$l.Description = 'agent-os'",
    "$l.Save()",
  ].join("\n");
}

/** Writes `agent-os.lnk` on the Windows desktop. Returns its path, or null when skipped (not Windows, no exe, no desktop). */
export function createDesktopShortcut(repoRoot: string, deps: ShortcutDeps = systemDeps()): string | null {
  if (deps.platform !== "win32") return null;
  const exe = findDesktopExe(repoRoot, deps);
  if (!exe) return null;
  const desktop = desktopFolder(deps);
  if (!desktop) return null;
  const lnk = win32.join(desktop, "agent-os.lnk");
  if (deps.powershell(shortcutScript(lnk, exe)) === null) return null;
  return deps.exists(lnk) ? lnk : null;
}
