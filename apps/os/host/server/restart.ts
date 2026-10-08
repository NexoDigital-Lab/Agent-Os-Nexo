// Restart on the user's request (the "Restart now" button): a small detached helper (relaunch.ts) waits for this
// process to end, then starts the build to load — the same one `nexo os start` would pick — on the same port, with
// the same access token, so the open page just reloads. agent-os-nexo still never restarts on its own: only the
// user's click on its own page (with this run's token, which agents never see) gets here.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildToLoad } from "../../src/core/versions.ts";
import type { Env } from "./env.ts";

export interface RelaunchPlan {
  /** The process to wait for before starting again (it holds the port). */
  waitFor: number;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** This run's access token, written to the new server's stdin (not its environment: see takeInheritedToken). */
  token: string;
  /** Where the new server's output goes (the launcher's log, else .state/os/restart.log). */
  log: string;
  /** The launcher's pid file (`nexo os`, the desktop app), rewritten with the new pid so they can stop it. */
  pidFile: string | null;
}

/** What to start: the preview restarts on the source; a build restarts on the build to load (pin, else newest). */
export function relaunchPlan(opts: { appDir: string; env: Env; port: number; dev: boolean; token: string; pid?: number; vars?: NodeJS.ProcessEnv }): RelaunchPlan {
  const { appDir, env, port, dev, token, pid = process.pid, vars = process.env } = opts;
  const target = dev ? null : buildToLoad(env.os);
  const dir = target && existsSync(join(env.os, "versions", target, "host", "server", "main.ts")) ? join(env.os, "versions", target) : appDir;
  const inherited = Object.fromEntries(Object.entries(vars).filter((e): e is [string, string] => typeof e[1] === "string"));
  return {
    waitFor: pid,
    command: process.execPath,
    args: [join(dir, "host", "server", "main.ts"), "--port", String(port), ...(dev ? ["--dev"] : [])],
    cwd: dir,
    env: { ...inherited, NEXO_ROOT: env.root, NEXO_ACCESS_TOKEN_STDIN: "1" },
    token,
    log: vars.NEXO_LOG_FILE || join(env.state, "restart.log"),
    pidFile: vars.NEXO_PID_FILE || null,
  };
}

/** Hands the plan to the detached helper. The caller exits right after; the helper outlives it. */
export function startRelaunch(plan: RelaunchPlan, launch: typeof spawn = spawn): void {
  const helper = join(import.meta.dirname, "relaunch.ts");
  // The plan (with the token) travels on stdin, never on a command line other programs can read.
  const child = launch(process.execPath, [helper], { detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  child.on("error", (e) => console.error("[agent-os-nexo] restart helper failed:", e));
  child.stdin?.end(JSON.stringify(plan));
  child.unref();
}

/** Ends this server so the helper can take the port: the whole process group on POSIX (agents, language servers). */
export function exitForRestart(
  platform: NodeJS.Platform = process.platform,
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill,
  exit: (code: number) => void = process.exit,
): void {
  if (platform !== "win32") {
    try {
      kill(-process.pid, "SIGTERM"); // only works when this server leads its group, as `nexo os` and the desktop app start it
    } catch {
      // not a group leader (started by hand): just this process
    }
  }
  exit(0);
}
