import { execFileSync } from "node:child_process";

/** Runs a command and returns trimmed stdout+stderr, or null when it fails or is missing. */
export function tryRun(cmd: string, args: string[], timeoutMs = 5000): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
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
