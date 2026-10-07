// Docker through its own CLI, so it talks to whatever engine the active context points at (Docker Desktop here)
// with no socket path guessing. Containers and images for the Docker view; devenv.ts builds on dockerRun().
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { httpError, userBinPath } from "../../../host/server/http.ts";

export const DOCKER_ENV = { ...process.env, PATH: userBinPath().join(path.delimiter) };

/** The process launcher; tests swap `execFile` for a fake so no real docker runs. */
export const dockerExec: { execFile: typeof execFile } = { execFile };

/** Docker Desktop's exe on Windows when installed, else null. */
function winDesktopExe(): string | null {
  if (process.platform !== "win32") return null;
  return [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter((d): d is string => !!d)
    .map((d) => path.join(d, "Docker", "Docker", "Docker Desktop.exe"))
    .find((f) => existsSync(f)) ?? null;
}

/** The platform and the installed Desktop path; tests swap both so no real Desktop starts. */
export const dockerSys: {
  platform: NodeJS.Platform;
  /** Docker Desktop's exe on Windows when installed; null otherwise (tests set this). */
  desktop: string | null;
  /** The Desktop launcher; tests swap it so no real Docker Desktop starts. */
  spawnDesktop: (exe: string) => void;
} = {
  platform: process.platform,
  desktop: winDesktopExe(),
  spawnDesktop: (exe) => {
    spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  },
};

const DAEMON_DOWN = /Cannot connect to the Docker daemon|docker daemon is not running|error during connect|failed to connect to the docker API/i;

const daemonDownMessage = () => {
  if (dockerSys.platform !== "win32") return "Docker is not running (open Docker Desktop or start the daemon)";
  return "Docker is not running. The Docker CLI is installed — start Docker Desktop or your Docker daemon to use containers.";
};

const missingCliMessage = () => "The Docker CLI was not found.";

export function dockerRun(args: string[], timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) =>
    dockerExec.execFile("docker", args, { env: DOCKER_ENV, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      // A killed process is our own timeout (stderr is empty then, so check it first).
      if (err.killed) return reject(httpError(504, `docker took more than ${Math.round(timeout / 1000)} s to answer`));
      if (DAEMON_DOWN.test(stderr)) return reject(httpError(503, daemonDownMessage()));
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return reject(httpError(503, missingCliMessage()));
      const msg = (stderr || err.message).trim().split("\n").pop() || "docker failed";
      reject(httpError(400, msg));
    }),
  );
}

const jsonLines = <T>(out: string): T[] => out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

export type Container = {
  id: string; name: string; image: string; state: string; status: string; ports: string; created: string;
  project: string | null; // set on agent-os-nexo dev containers (label agent-os-nexo.project)
};
export type Image = { id: string; repo: string; tag: string; size: string; created: string; inUse: boolean };

export type DockerAction = "open-desktop" | "install-cli" | null;

export type DockerCliInfo = { found: boolean; version: string | null };

export type DockerInfo = {
  ok: boolean; // daemon answering
  cli: DockerCliInfo;
  version?: string; // SERVER version, only when ok
  context?: string; // only when ok
  error?: string; // when !ok
  action?: DockerAction;
  installHint?: string; // only when action === "install-cli"
};

/** Probes the CLI first (works with the daemon down), then the daemon itself. */
export async function info(): Promise<DockerInfo> {
  const cliLine = await dockerRun(["--version"], 8000).then((o) => o.trim().split("\n")[0] ?? "", () => null);
  const cli: DockerCliInfo = cliLine ? { found: true, version: cliLine } : { found: false, version: null };
  if (!cli.found) {
    return {
      ok: false,
      cli,
      error: "The Docker CLI was not found.",
      action: "install-cli",
      installHint: dockerSys.platform === "win32" ? "winget install Docker.DockerDesktop" : "https://docs.docker.com/get-docker/",
    };
  }
  try {
    const [version, context] = await Promise.all([
      dockerRun(["version", "--format", "{{.Server.Version}}"], 8000),
      dockerRun(["context", "show"], 8000),
    ]);
    return { ok: true, cli, version: version.trim(), context: context.trim() };
  } catch (e) {
    return { ok: false, cli, error: (e as Error).message, action: dockerSys.desktop ? "open-desktop" : null };
  }
}

/** Starts Docker Desktop (Windows-only in practice: desktop is null elsewhere). */
export function openDockerDesktop(): { ok: true; path: string } {
  if (!dockerSys.desktop) throw httpError(400, "Docker Desktop is not installed");
  dockerSys.spawnDesktop(dockerSys.desktop);
  return { ok: true, path: dockerSys.desktop };
}

export async function containers(): Promise<Container[]> {
  type Row = { ID: string; Names: string; Image: string; State: string; Status: string; Ports: string; CreatedAt: string; Labels: string };
  const rows = jsonLines<Row>(await dockerRun(["ps", "-a", "--no-trunc", "--format", "{{json .}}"]));
  return rows.map((r) => ({
    id: r.ID.slice(0, 12), name: r.Names, image: r.Image, state: r.State, status: r.Status, ports: r.Ports, created: r.CreatedAt,
    project: /(?:^|,)agent-os-nexo\.project=([^,]+)/.exec(r.Labels)?.[1] ?? null,
  }));
}

const short = (id: string) => id.replace("sha256:", "").slice(0, 12);

/** Short ids of the images any container (running or not) was created from. */
async function usedImageIds(): Promise<Set<string>> {
  const ids = (await dockerRun(["ps", "-aq"])).split("\n").filter(Boolean);
  if (!ids.length) return new Set();
  const shas = await dockerRun(["inspect", "--format", "{{.Image}}", ...ids]);
  return new Set(shas.split("\n").filter(Boolean).map(short));
}

export async function images(): Promise<Image[]> {
  type Row = { ID: string; Repository: string; Tag: string; Size: string; CreatedSince: string };
  const [rows, used] = await Promise.all([
    dockerRun(["images", "--format", "{{json .}}"]).then(jsonLines<Row>),
    usedImageIds().catch(() => new Set<string>()), // only drives the "in use" badge; the list is still useful without it
  ]);
  return rows.map((r) => ({ id: short(r.ID), repo: r.Repository, tag: r.Tag, size: r.Size, created: r.CreatedSince, inUse: used.has(short(r.ID)) }));
}

const REF = /^[\w][\w.\-/:@]*$/; // container names/ids and image refs; never an option like "-f"

function ref(x: string) {
  if (!REF.test(x)) throw httpError(400, `Invalid reference: ${x}`);
  return x;
}

/** The agent-os-nexo project a container was created for (label agent-os-nexo.project), or null. */
export const projectLabel = (id: string) =>
  dockerRun(["inspect", "-f", '{{index .Config.Labels "agent-os-nexo.project"}}', ref(id)], 8000).then((o) => o.trim() || null, () => null);

export type ContainerAction = "start" | "stop" | "restart" | "rm";
export async function containerAction(id: string, action: ContainerAction) {
  const args = action === "rm" ? ["rm", "-f", ref(id)] : [action, ref(id)];
  await dockerRun(args, 60_000);
}

export const logs = (id: string, tail = 400) => dockerRun(["logs", "--tail", String(tail), "--timestamps", ref(id)]).catch((e) => `(${e.message})`);
export const removeImage = (id: string) => dockerRun(["rmi", ref(id)]).then(() => undefined);
export const pull = (image: string) => dockerRun(["pull", "--quiet", ref(image)], 15 * 60_000).then((o) => o.trim());

/** argv for an interactive shell inside a container: bash when it has one, sh otherwise. */
export function execShellArgs(container: string, cwd?: string): string[] {
  return ["exec", "-it", ...(cwd ? ["-w", cwd] : []), ref(container), "sh", "-c", "command -v bash >/dev/null && exec bash -l || exec sh -l"];
}
