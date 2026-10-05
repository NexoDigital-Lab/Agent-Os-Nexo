// agent-os in an environment: the user's source copy (os/source), its builds (os/versions/<x.y.z>), the
// dependencies they share (os/runtime/<hash>, one per dependency set, linked as node_modules), and the running
// processes (pid + log in .state/os). Everything here shells out to node, npm and tar: no runtime dependencies.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdtempSync, openSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { ensureDir, readJson, readText, writeJson, writeText } from "./fsx.ts";
import { activeVersion, listVersions, nextVersion } from "./osversions.ts";

export const OS_PACKAGE = "@nexodigital-lab/agent-os";
export const PORTS = { app: 4780, preview: 4781 } as const;
export type OsProcess = keyof typeof PORTS;

/** Runs a command, throwing when it fails. Tests pass a fake. */
export type Runner = (cmd: string, args: string[], cwd: string) => void;

export const defaultRunner: Runner = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`\`${cmd} ${args.join(" ")}\` failed (exit ${r.status}) in ${cwd}`);
};

/** What a source copy never carries: dependencies, build output, VCS. */
const SKIP = new Set(["node_modules", "dist", ".git"]);

export function copySource(from: string, to: string): void {
  if (!existsSync(join(from, "package.json")) || !existsSync(join(from, "modules"))) {
    throw new Error(`${from} is not an agent-os source (no package.json or modules/).`);
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

/** os/runtime/<hash> for the source's dependencies, installed once with npm. */
export function ensureRuntime(osDir: string, sourceDir: string, run: Runner = defaultRunner): { hash: string; dir: string; installed: boolean } {
  const pkg = readJson<Pkg>(join(sourceDir, "package.json"));
  const hash = runtimeHash(pkg);
  const dir = join(osDir, "runtime", hash);
  if (existsSync(join(dir, "node_modules"))) return { hash, dir, installed: false };
  ensureDir(dir);
  writeJson(join(dir, "package.json"), { name: "agent-os-runtime", private: true, type: "module", dependencies: runtimeDeps(pkg) });
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  if (!existsSync(join(dir, "node_modules"))) throw new Error(`npm did not create ${join(dir, "node_modules")}.`);
  return { hash, dir, installed: true };
}

/** Points `<target>/node_modules` at a runtime (replacing an older link, never a real folder). */
export function linkRuntime(target: string, runtimeDir: string): void {
  const link = join(target, "node_modules");
  if (existsSync(link) || isLink(link)) {
    if (!isLink(link)) throw new Error(`${link} is a real folder; agent-os expects a link to os/runtime/. Remove it first.`);
    rmSync(link);
  }
  symlinkSync(join(runtimeDir, "node_modules"), link, "dir");
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Copies the agent-os package into os/source: from a local folder, or from npm (`npm pack` + tar). */
export function fetchSource(osDir: string, from: string | undefined, run: Runner = defaultRunner): string {
  const source = join(osDir, "source");
  if (existsSync(source) && readdirSync(source).length) {
    throw new Error(`${source} already holds agent-os (your personal copy). Remove it first to install again.`);
  }
  if (from) {
    copySource(from, source);
    return `copied from ${from}`;
  }
  const tmp = mkdtempSync(join(tmpdir(), "nexo-os-"));
  try {
    run("npm", ["pack", OS_PACKAGE, "--pack-destination", tmp, "--silent"], tmp);
    const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error(`npm pack did not download ${OS_PACKAGE}.`);
    run("tar", ["-xzf", tgz], tmp);
    copySource(join(tmp, "package"), source);
    return `downloaded ${tgz.replace(/\.tgz$/, "")}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Builds os/source into os/versions/<next> (written to a temp folder first, so a failed build leaves nothing). */
export function buildVersion(osDir: string, notes = "", run: Runner = defaultRunner): string {
  const source = join(osDir, "source");
  if (!existsSync(join(source, "scripts", "build.ts"))) throw new Error(`No agent-os source in ${source}. Run \`nexo os install\` first.`);
  const runtime = ensureRuntime(osDir, source, run);
  linkRuntime(source, runtime.dir);
  const version = nextVersion(listVersions(osDir).at(-1) ?? null);
  const final = join(osDir, "versions", version);
  const tmp = `${final}.building`;
  rmSync(tmp, { recursive: true, force: true });
  try {
    run(process.execPath, [join(source, "scripts", "build.ts"), "--out", tmp, "--version", version, "--notes", notes, "--runtime", runtime.hash], source);
    linkRuntime(tmp, runtime.dir);
    renameSync(tmp, final);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return version;
}

// ── processes ──────────────────────────────────────────────────────────────────────────────────────────────────

const pidFile = (stateDir: string, p: OsProcess) => join(stateDir, "os", `${p}.pid`);
export const logFile = (stateDir: string, p: OsProcess) => join(stateDir, "os", `${p}.log`);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The pid of a running agent-os process, cleaning up a stale pid file. */
export function runningPid(stateDir: string, p: OsProcess): number | null {
  const file = pidFile(stateDir, p);
  if (!existsSync(file)) return null;
  const pid = Number(readText(file).trim());
  if (Number.isInteger(pid) && pid > 0 && alive(pid)) return pid;
  rmSync(file, { force: true });
  return null;
}

/** Starts the active build (`app`) or the source with hot reload (`preview`) in the background. */
export function startProcess(root: string, osDir: string, stateDir: string, p: OsProcess, port: number = PORTS[p]): { pid: number; version: string } {
  const existing = runningPid(stateDir, p);
  if (existing) throw new Error(`agent-os ${p === "app" ? "is" : "preview is"} already running (pid ${existing}). Stop it with \`nexo os stop\`.`);
  let dir: string;
  let version: string;
  if (p === "app") {
    const active = activeVersion(osDir);
    if (!active) throw new Error("agent-os has no builds yet. Run `nexo os install` (or `nexo os build`).");
    dir = join(osDir, "versions", active);
    if (!existsSync(dir)) throw new Error(`The pinned build ${active} is missing from os/versions/. Run \`nexo os use latest\`.`);
    version = active;
  } else {
    dir = join(osDir, "source");
    if (!existsSync(join(dir, "node_modules"))) throw new Error("os/source has no dependencies linked. Run `nexo os build` once.");
    version = "source";
  }
  ensureDir(join(stateDir, "os"));
  const log = openSync(logFile(stateDir, p), "a");
  const args = [join(dir, "host", "server", "main.ts"), "--port", String(port), ...(p === "preview" ? ["--dev"] : [])];
  const child = spawn(process.execPath, args, { cwd: dir, detached: true, stdio: ["ignore", log, log], env: { ...process.env, NEXO_ROOT: root } });
  child.unref();
  if (!child.pid) throw new Error("agent-os did not start.");
  writeText(pidFile(stateDir, p), String(child.pid));
  return { pid: child.pid, version };
}

/** Stops the given agent-os processes; returns the ones that were running. */
export function stopProcesses(stateDir: string, which: OsProcess[]): OsProcess[] {
  const stopped: OsProcess[] = [];
  for (const p of which) {
    const pid = runningPid(stateDir, p);
    if (!pid) continue;
    try {
      process.kill(-pid, "SIGTERM"); // the whole group: it was started detached
    } catch {
      process.kill(pid, "SIGTERM");
    }
    rmSync(pidFile(stateDir, p), { force: true });
    stopped.push(p);
  }
  return stopped;
}
