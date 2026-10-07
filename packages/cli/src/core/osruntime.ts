// agent-os-nexo in an environment: the user's source copy (os/source), its builds (os/versions/<x.y.z>), the
// dependencies they share (os/runtime/<hash>, one per dependency set, linked as node_modules), and the running
// processes (pid + log in .state/os). Everything here shells out to node, npm and tar: no runtime dependencies.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, lstatSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { ensureDir, linkDir, readJson, readText, writeJson, writeText } from "./fsx.ts";
import { spawnable, tryRun } from "./exec.ts";
import { activeVersion, listVersions, nextVersion } from "./osversions.ts";
import { commitChanges, initSourceRepo, tagBuild } from "./osupdate.ts";

export const OS_PACKAGE = "@nexodigital/agent-os-nexo";
export const PORTS = { app: 4780, preview: 4781 } as const;
export type OsProcess = keyof typeof PORTS;

/** Runs a command, throwing when it fails. Tests pass a fake. */
export type Runner = (cmd: string, args: string[], cwd: string) => void;

export const defaultRunner: Runner = (cmd, args, cwd) => {
  const s = spawnable(cmd, args);
  const r = spawnSync(s.file, s.args, { cwd, stdio: "inherit", windowsVerbatimArguments: s.verbatim });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`\`${cmd} ${args.join(" ")}\` failed (exit ${r.status}) in ${cwd}`);
};

/** What a source copy never carries: dependencies, build output, VCS. */
const SKIP = new Set(["node_modules", "dist", ".git"]);

export function copySource(from: string, to: string): void {
  if (!existsSync(join(from, "package.json")) || !existsSync(join(from, "modules"))) {
    throw new Error(`${from} is not an agent-os-nexo source (no package.json or modules/).`);
  }
  cpSync(from, to, { recursive: true, filter: (p) => !relative(from, p).split(/[\\/]/).some((part) => SKIP.has(part)) });
}

type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

/** The dependency set of a source, all of it (builds need Vite and React; the server needs the rest). */
export function runtimeDeps(pkg: Pkg): Record<string, string> {
  const all = { ...pkg.devDependencies, ...pkg.dependencies };
  return Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)));
}

/** Short, stable id of a dependency set: builds with the same dependencies share one runtime. */
export function runtimeHash(pkg: Pkg): string {
  return createHash("sha256").update(JSON.stringify(runtimeDeps(pkg))).digest("hex").slice(0, 12);
}

/** Written after npm succeeds: a node_modules without it is an interrupted install, never reused. */
const READY = ".ready";

/** os/runtime/<hash> for the source's dependencies, installed once with npm. */
export function ensureRuntime(osDir: string, sourceDir: string, run: Runner = defaultRunner): { hash: string; dir: string; installed: boolean } {
  const pkg = readJson<Pkg>(join(sourceDir, "package.json"));
  const hash = runtimeHash(pkg);
  const dir = join(osDir, "runtime", hash);
  if (existsSync(join(dir, READY)) && existsSync(join(dir, "node_modules"))) return { hash, dir, installed: false };
  rmSync(join(dir, "node_modules"), { recursive: true, force: true }); // a previous install that never finished
  ensureDir(dir);
  writeJson(join(dir, "package.json"), { name: "agent-os-nexo-runtime", private: true, type: "module", dependencies: runtimeDeps(pkg) });
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  if (!existsSync(join(dir, "node_modules"))) throw new Error(`npm did not create ${join(dir, "node_modules")}.`);
  writeText(join(dir, READY), new Date().toISOString());
  return { hash, dir, installed: true };
}

/** Points `<target>/node_modules` at a runtime (replacing an older link, never a real folder). */
export function linkRuntime(target: string, runtimeDir: string): void {
  const link = join(target, "node_modules");
  if (existsSync(link) || isLink(link)) {
    if (!isLink(link)) throw new Error(`${link} is a real folder; agent-os-nexo expects a link to os/runtime/. Remove it first.`);
    rmSync(link);
  }
  linkDir(join(runtimeDir, "node_modules"), link);
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Copies the agent-os-nexo package into os/source: from a local folder, or from npm (`npm pack` + tar). */
/**
 * A release of agent-os-nexo, ready in a folder: `from` itself (a checkout), or downloaded from npm (`npm pack` + tar)
 * into a temporary folder. `use` gets the folder; the download is removed afterwards.
 */
export function withRelease<T>(from: string | undefined, run: Runner, use: (dir: string, label: string) => T): T {
  if (from) return use(from, `from ${from}`);
  const tmp = mkdtempSync(join(tmpdir(), "nexo-os-"));
  try {
    try {
      run("npm", ["pack", OS_PACKAGE, "--pack-destination", tmp, "--silent"], tmp);
    } catch {
      throw new Error(`Could not download ${OS_PACKAGE} from npm. Until it is published, use a checkout: --from <Agent-Os-Nexo>/apps/os`);
    }
    const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error(`npm pack did not download ${OS_PACKAGE}.`);
    run("tar", ["-xzf", tgz], tmp);
    return use(join(tmp, "package"), `downloaded ${tgz.replace(/\.tgz$/, "")}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Copies the agent-os-nexo package into os/source and starts its history (osupdate.ts). */
export function fetchSource(osDir: string, from: string | undefined, run: Runner = defaultRunner): string {
  const source = join(osDir, "source");
  if (existsSync(source) && readdirSync(source).length) {
    throw new Error(`${source} already holds agent-os-nexo (your personal copy). Remove it first to install again.`);
  }
  return withRelease(from, run, (dir, label) => {
    copySource(dir, source);
    initSourceRepo(source);
    return label;
  });
}

/** Builds os/source into os/versions/<next> (written to a temp folder first, so a failed build leaves nothing). */
export function buildVersion(osDir: string, notes = "", run: Runner = defaultRunner): string {
  const source = join(osDir, "source");
  if (!existsSync(join(source, "scripts", "build.ts"))) throw new Error(`No agent-os-nexo source in ${source}. Run \`nexo os install\` first.`);
  const runtime = ensureRuntime(osDir, source, run);
  linkRuntime(source, runtime.dir);
  const version = nextVersion(listVersions(osDir).at(-1) ?? null);
  // The source as built is a commit of the user's branch, so every version can be told apart and updated later.
  initSourceRepo(source);
  commitChanges(source, `agent-os-nexo ${version}${notes ? `: ${notes}` : ""}`);
  const final = join(osDir, "versions", version);
  const tmp = `${final}.building`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    // --opt=value: a value starting with "-" would otherwise read as another option.
    run(process.execPath, [join(source, "scripts", "build.ts"), `--out=${tmp}`, `--version=${version}`, `--notes=${notes}`, `--runtime=${runtime.hash}`], source);
    linkRuntime(tmp, runtime.dir);
    renameSync(tmp, final);
    tagBuild(source, version);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return version;
}

// ── processes ──────────────────────────────────────────────────────────────────────────────────────────────────

const pidFile = (stateDir: string, p: OsProcess) => join(stateDir, "os", `${p}.pid`);
const portFile = (stateDir: string, p: OsProcess) => join(stateDir, "os", `${p}.port`);

/** The port a running process was started on (its default when unknown). */
export function runningPort(stateDir: string, p: OsProcess): number {
  const file = portFile(stateDir, p);
  const port = existsSync(file) ? Number(readText(file).trim()) : NaN;
  return Number.isInteger(port) && port > 0 ? port : PORTS[p];
}

/**
 * The address to open: with this run's access token (the server writes .state/os/token-<port> at startup, see
 * apps/os/host/server/access.ts), or the bare address when the server predates tokens.
 */
export function accessLink(stateDir: string, port: number): string {
  const file = join(stateDir, "os", `token-${port}`);
  const token = existsSync(file) ? readText(file).trim() : "";
  return `http://localhost:${port}/${token ? `?token=${token}` : ""}`;
}

/** The command that opens a link in the user's browser on this system. */
export function openerFor(platform: NodeJS.Platform = process.platform): { cmd: string; args: (url: string) => string[] } {
  if (platform === "darwin") return { cmd: "open", args: (u) => [u] };
  if (platform === "win32") return { cmd: "cmd", args: (u) => ["/c", "start", "", u] };
  return { cmd: "xdg-open", args: (u) => [u] };
}
export const logFile = (stateDir: string, p: OsProcess) => join(stateDir, "os", `${p}.log`);

/** The command line of a live process we may signal, or null (gone, or another user's). */
export function commandOf(pid: number, platform: NodeJS.Platform = process.platform): string | null {
  try {
    process.kill(pid, 0);
  } catch {
    return null; // ESRCH: gone; EPERM: someone else's process, never ours to stop
  }
  if (platform === "win32") {
    // No /proc and no ps: Windows keeps the command line in WMI.
    const query = `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`;
    return tryRun("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], 15_000) ?? "";
  }
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
  } catch {
    return tryRun("ps", ["-p", String(pid), "-o", "command="]) ?? ""; // macOS and other systems without /proc
  }
}

/** Ends a process and what it started: its group on Unix (it was started detached), its tree on Windows. */
export function killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32" && tryRun("taskkill", ["/pid", String(pid), "/T", "/F"], 15_000) !== null) return;
  for (const target of platform === "win32" ? [pid] : [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
      return;
    } catch {
      // no group, or already gone: try the process itself, then give up quietly
    }
  }
}

/** A pid file can outlive its process (reboot, crash) and the pid can be reused: only an agent-os-nexo server counts. */
const isAgentOsNexo = (cmd: string | null) => !!cmd && /host[\\/]server[\\/]main\.ts/.test(cmd);

/** The pid of a running agent-os-nexo process, cleaning up a stale pid file. */
export function runningPid(stateDir: string, p: OsProcess): number | null {
  const file = pidFile(stateDir, p);
  if (!existsSync(file)) return null;
  const pid = Number(readText(file).trim());
  if (Number.isInteger(pid) && pid > 0 && isAgentOsNexo(commandOf(pid))) return pid;
  rmSync(file, { force: true });
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Answers like agent-os-nexo: 200 from /api/os/info, stamped X-Agent-OS-Nexo (a foreign program on the port doesn't count). */
async function answers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/os/info`, { signal: AbortSignal.timeout(1500) });
    return res.ok && res.headers.get("x-agent-os-nexo") === "1";
  } catch {
    return false;
  }
}

const lastLines = (file: string, n = 12) => (existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n") : "");

/**
 * Starts the active build (`app`) or the source with hot reload (`preview`) in the background, and returns once it
 * answers on its port. If it exits or doesn't answer in time, the error carries the end of its log.
 */
export async function startProcess(
  root: string, osDir: string, stateDir: string, p: OsProcess, port: number = PORTS[p], timeoutMs = 60_000,
): Promise<{ pid: number; version: string }> {
  const existing = runningPid(stateDir, p);
  if (existing) throw new Error(`agent-os-nexo ${p === "app" ? "is" : "preview is"} already running (pid ${existing}). Stop it with \`nexo os stop${p === "preview" ? " --preview" : ""}\`.`);
  if (await answers(port)) throw new Error(`An agent-os-nexo is already answering on port ${port}. Use another one with --port.`);
  let dir: string;
  let version: string;
  if (p === "app") {
    const active = activeVersion(osDir);
    if (!active) throw new Error("agent-os-nexo has no builds yet. Run `nexo os install` (or `nexo os build`).");
    dir = join(osDir, "versions", active);
    if (!existsSync(dir)) throw new Error(`The pinned build ${active} is missing from os/versions/. Run \`nexo os use latest\`.`);
    version = active;
  } else {
    dir = join(osDir, "source");
    if (!existsSync(join(dir, "node_modules"))) throw new Error("os/source has no dependencies linked. Run `nexo os build` once.");
    version = "source";
  }
  ensureDir(join(stateDir, "os"));
  const log = logFile(stateDir, p);
  const fd = openSync(log, "a");
  const args = [join(dir, "host", "server", "main.ts"), "--port", String(port), ...(p === "preview" ? ["--dev"] : [])];
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: dir, detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env: { ...process.env, NEXO_ROOT: root } });
  } finally {
    closeSync(fd); // the child has its own copy
  }
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error("agent-os-nexo did not start.");
  let exited = false;
  child.once("exit", () => (exited = true));
  writeText(pidFile(stateDir, p), String(pid));
  writeText(portFile(stateDir, p), String(port));
  for (const until = Date.now() + timeoutMs; Date.now() < until && !exited; await sleep(250)) {
    if (await answers(port)) return { pid, version };
  }
  if (!exited) stopProcesses(stateDir, [p]);
  rmSync(pidFile(stateDir, p), { force: true });
  throw new Error(`agent-os-nexo ${exited ? "exited" : "did not answer"} on port ${port}. End of ${log}:\n${lastLines(log)}`);
}

/** Stops the given agent-os-nexo processes; returns the ones that were running. */
export function stopProcesses(stateDir: string, which: OsProcess[]): OsProcess[] {
  const stopped: OsProcess[] = [];
  for (const p of which) {
    const pid = runningPid(stateDir, p);
    if (!pid) continue;
    killTree(pid); // with the agents it ran
    rmSync(pidFile(stateDir, p), { force: true });
    rmSync(portFile(stateDir, p), { force: true });
    stopped.push(p);
  }
  return stopped;
}
