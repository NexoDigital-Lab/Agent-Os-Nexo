// Creates a Windows desktop shortcut for agent-os (the Tauri desktop shell). No-op on other platforms.
// Called from `nexo os install` so every Windows install ends with a double-clickable icon.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Where the Tauri build puts the executable and icon, relative to this CLI package. */
function desktopPaths(cliDir: string): { exe: string; icon: string } | null {
  // packages/cli/src/core/ → repo root is four levels up
  const repo = join(cliDir, "..", "..", "..", "..");
  const exe = join(repo, "apps", "desktop", "src-tauri", "target", "release", "agent-os-desktop.exe");
  const icon = join(repo, "apps", "desktop", "src-tauri", "icons", "icon.ico");
  if (!existsSync(exe)) return null;
  return { exe, icon };
}

/** The user's Desktop folder, including OneDrive-redirected ones. */
function desktopDir(): string | null {
  try {
    const out = execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Environment]::GetFolderPath('Desktop')",
    ], { encoding: "utf8", timeout: 5000 }).trim();
    return out || null;
  } catch {
    // Fallback: the classic location
    const classic = join(homedir(), "Desktop");
    return existsSync(classic) ? classic : null;
  }
}

/**
 * Creates `agent-os.lnk` on the Windows desktop, pointing at the Tauri shell with its icon.
 * Returns true when a shortcut was written, false when skipped (non-Windows, no build, or no desktop).
 */
export function createDesktopShortcut(cliDir: string): boolean {
  if (process.platform !== "win32") return false;
  const paths = desktopPaths(cliDir);
  if (!paths) return false;
  const desktop = desktopDir();
  if (!desktop) return false;

  const lnk = join(desktop, "agent-os.lnk");
  const iconArg = existsSync(paths.icon) ? paths.icon : paths.exe;
  const script = `
    $ws = New-Object -ComObject WScript.Shell
    $l = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')
    $l.TargetPath = '${paths.exe.replace(/'/g, "''")}'
    $l.WorkingDirectory = '${(paths.exe.split(/[\\/]/).slice(0, -1).join("\\"))}'
    $l.IconLocation = '${iconArg.replace(/'/g, "''")}'
    $l.Description = 'agent-os'
    $l.Save()
  `;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 10000 });
    return existsSync(lnk);
  } catch {
    return false;
  }
}
