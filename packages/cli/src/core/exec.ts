import { execFileSync } from "node:child_process";

/**
 * Resolves a command name for the current platform. On Windows, npm and its
 * siblings are `.cmd` shims that `spawnSync`/`execFileSync` cannot find by bare name.
 */
export function resolveCmd(cmd: string): string {
  if (process.platform !== "win32") return cmd;
  if (cmd.includes("/") || cmd.includes("\\")) return cmd;
  const winShims = new Set(["npm", "npx", "yarn", "pnpm", "corepack"]);
  return winShims.has(cmd) ? `${cmd}.cmd` : cmd;
}

/** True when the platform requires `shell: true` to execute `.cmd` shims. */
export function needsShell(cmd: string): boolean {
  return process.platform === "win32" && resolveCmd(cmd) !== cmd;
}

/** Runs a command and returns trimmed stdout+stderr, or null when it fails or is missing. */
export function tryRun(cmd: string, args: string[], timeoutMs = 5000): string | null {
  try {
    return execFileSync(resolveCmd(cmd), args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      shell: needsShell(cmd),
    }).trim();
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number | null };
    // Some tools (java -version) print to stderr and still exit 0 or 1; keep their output.
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    return err.status === 0 && out ? out : null;
  }
}

export function gitConfig(key: string): string {
  return tryRun("git", ["config", "--get", key]) ?? "";
}
