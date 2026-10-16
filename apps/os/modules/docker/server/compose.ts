// A project's own Docker stack: what its compose files declare (read through `docker compose config`, so includes,
// profiles and interpolation resolve like they do for the user), which compose projects of the engine belong to it
// (by the config files compose records), the start profiles saved in projects/<p>/context/docker.json, and
// up/stop/restart/logs of one profile. Environment values never leave this file: `config` expands .env into them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { httpError, writeJson } from "../../../host/server/http.ts";
import { safePath } from "../../projects/server/repo.ts";
import { dockerRun } from "./docker.ts";

export type Engine = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";
export type ServiceKind = "app" | "db" | "db-ui";
export type Port = { published: number | null; target: number; hostIp: string | null };
export type Service = {
  name: string;
  image: string | null;
  build: boolean;
  ports: Port[];
  dependsOn: string[];
  containerName: string | null;
  profiles: string[];
  kind: ServiceKind;
  engine: Engine | null;
};
export type ComposeFile = { file: string; project: string | null; prod: boolean; services: Service[]; error?: string };
export type Detection = { dockerfiles: string[]; compose: ComposeFile[] };

export type Profile = { label?: string; files: string[]; projectName: string; services: string[]; stop: "stop" | "down" };
export type StackConfig = { version: 1; default: string; profiles: Record<string, Profile> };

export type ServiceState = { service: string; container: string; state: string; health: string; exitCode: number; ports: Port[] };
export type StackState = "stopped" | "starting" | "running" | "partial" | "error" | "stopping";
export type StackStatus = { state: StackState; services: ServiceState[]; busy: Action | null; lastError: string | null };
export type Action = "up" | "stop" | "restart";

const COMPOSE_FILE = /^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/i;
const DOCKERFILE = /^Dockerfile([.-][\w.-]+)?$|\.dockerfile$/i;
const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", ".venv", "venv", "target", "worktrees"]);
const PROFILE_ID = /^[\w-]{1,40}$/;
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SERVICE = /^[a-zA-Z0-9][\w.-]{0,62}$/;
const PROD = /(^|[^a-z])prod/i;

/** Compose and Dockerfiles in the repo, as paths relative to it (depth ≤ 3, no dependency or build folders). */
export function findFiles(repo: string): { compose: string[]; dockerfiles: string[] } {
  const compose: string[] = [];
  const dockerfiles: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.relative(repo, path.join(dir, e.name)).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (depth < 3 && !SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        if (COMPOSE_FILE.test(e.name)) compose.push(rel);
        else if (DOCKERFILE.test(e.name)) dockerfiles.push(rel);
      }
    }
  };
  walk(repo, 0);
  return { compose, dockerfiles };
}

const ENGINES: [RegExp, Engine][] = [
  [/^(postgres|postgresql|postgis|timescaledb(-ha)?|pgvector)$/, "postgres"],
  [/^mariadb$/, "mariadb"],
  [/^(mysql|mysql-server|percona-server)$/, "mysql"],
  [/^(mongo|mongodb|mongodb-community-server)$/, "mongo"],
  [/^(redis|redis-stack(-server)?|valkey)$/, "redis"],
];
const DB_UIS = /^(adminer|pgadmin4?|redis-commander|redisinsight|mongo-express|phpmyadmin|pgweb|dbgate)$/;

/** What a service is, by its image's last path segment without the tag ("bitnami/postgresql:16" → postgres). */
export function classify(image: string | null): { kind: ServiceKind; engine: Engine | null } {
  const base = (image ?? "").split("@")[0]!.split("/").pop()!.split(":")[0]!.toLowerCase();
  for (const [re, engine] of ENGINES) if (re.test(base)) return { kind: "db", engine };
  return { kind: DB_UIS.test(base) ? "db-ui" : "app", engine: null };
}

const portNum = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
};

/** The few fields of `docker compose config --format json` the UI needs. `environment` is never read. */
export function services(config: unknown): Service[] {
  const raw = (config as { services?: Record<string, Record<string, unknown>> })?.services ?? {};
  return Object.entries(raw).map(([name, s]) => {
    const image = typeof s.image === "string" ? s.image : null;
    const ports = (Array.isArray(s.ports) ? s.ports : []).flatMap((p: Record<string, unknown>) => {
      const target = portNum(p?.target);
      return target ? [{ target, published: portNum(p.published), hostIp: typeof p.host_ip === "string" ? p.host_ip : null }] : [];
    });
    const dependsOn = Array.isArray(s.depends_on) ? s.depends_on.map(String) : Object.keys((s.depends_on as object) ?? {});
    return {
      name,
      image,
      build: !!s.build,
      ports,
      dependsOn,
      containerName: typeof s.container_name === "string" ? s.container_name : null,
      profiles: Array.isArray(s.profiles) ? s.profiles.map(String) : [],
      ...classify(image),
    };
  });
}

/** Every compose file of the repo, resolved by Docker itself. A file Docker cannot read keeps its error. */
export async function detect(repo: string): Promise<Detection> {
  const found = findFiles(repo);
  const compose = await Promise.all(found.compose.map(async (file): Promise<ComposeFile> => {
    const prod = PROD.test(file);
    try {
      const out = await dockerRun(["compose", "-f", path.join(repo, file), "config", "--format", "json"], 30_000);
      const config = JSON.parse(out) as { name?: unknown };
      return { file, project: typeof config.name === "string" ? config.name : null, prod, services: services(config) };
    } catch (e) {
      return { file, project: null, prod, services: [], error: (e as Error).message };
    }
  }));
  return { dockerfiles: found.dockerfiles, compose };
}

/** Compose projects the engine knows whose config files live in this repo (created from here, by hand or by us). */
export async function linkedStacks(repo: string): Promise<{ name: string; status: string; files: string[] }[]> {
  const out = await dockerRun(["compose", "ls", "-a", "--format", "json"], 15_000);
  const rows = JSON.parse(out || "[]") as { Name: string; Status: string; ConfigFiles: string }[];
  const inside = (f: string) => {
    const rel = path.relative(repo, f);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  return rows.flatMap((r) => {
    const files = String(r.ConfigFiles ?? "").split(",").filter(inside).map((f) => path.relative(repo, f).split(path.sep).join("/"));
    return files.length ? [{ name: r.Name, status: r.Status, files }] : [];
  });
}

// ---- start profiles, in projects/<p>/context/docker.json

const configFile = (projectDir: string) => path.join(projectDir, "context", "docker.json");

/** The saved profiles, or null. A file people edit by hand is never moved aside: a broken one reads as none. */
export function readStack(projectDir: string): StackConfig | null {
  let c: StackConfig | null = null;
  try {
    c = JSON.parse(readFileSync(configFile(projectDir), "utf8"));
  } catch {
    return null;
  }
  return c && c.version === 1 && c.profiles && typeof c.profiles === "object" && !Array.isArray(c.profiles) ? c : null;
}

/** Checks a profile against the repo: real compose files inside it, names Docker accepts, a known stop mode. */
function checkProfile(id: string, p: Profile, repo: string): Profile {
  if (!PROFILE_ID.test(id)) throw httpError(400, `Invalid profile id: ${id}`);
  const files = Array.isArray(p?.files) ? p.files.map(String) : [];
  if (!files.length) throw httpError(400, `Profile ${id} has no compose file`);
  for (const f of files) {
    const abs = safePath(repo, f);
    if (!COMPOSE_FILE.test(path.basename(abs)) || !existsSync(abs)) throw httpError(400, `Not a compose file of this project: ${f}`);
  }
  const projectName = String(p.projectName ?? "");
  if (!PROJECT_NAME.test(projectName)) throw httpError(400, `Invalid compose project name: ${projectName}`);
  const svc = Array.isArray(p.services) ? p.services.map(String) : [];
  for (const s of svc) if (!SERVICE.test(s)) throw httpError(400, `Invalid service name: ${s}`);
  if (p.stop !== "stop" && p.stop !== "down") throw httpError(400, `Invalid stop mode: ${String(p.stop)}`);
  return { ...(p.label ? { label: String(p.label).slice(0, 60) } : {}), files, projectName, services: [...new Set(svc)], stop: p.stop };
}

export function saveStack(projectDir: string, repo: string, body: unknown): StackConfig {
  const b = body as Partial<StackConfig>;
  const entries = Object.entries(b?.profiles ?? {});
  if (!entries.length) throw httpError(400, "At least one profile is needed");
  const profiles = Object.fromEntries(entries.map(([id, p]) => [id, checkProfile(id, p as Profile, repo)]));
  const def = String(b.default ?? "");
  if (!Object.hasOwn(profiles, def)) throw httpError(400, `The default profile is not one of the profiles: ${def}`);
  const config: StackConfig = { version: 1, default: def, profiles };
  writeJson(configFile(projectDir), config);
  return config;
}

/** A compose project name from a folder or file name, the way Compose normalizes it. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[^a-z0-9]+/, "") || "project";

/** One profile per readable compose file; the default is the first that does not look like production. */
export function propose(detection: Detection, repo: string): StackConfig | null {
  const usable = detection.compose.filter((c) => !c.error);
  if (!usable.length) return null;
  const profiles: Record<string, Profile> = {};
  for (const c of usable) {
    const stem = path.basename(c.file).replace(/\.ya?ml$/i, "").replace(/^(docker-)?compose[.-]?/i, "") || "default";
    let id = normalize(stem).slice(0, 40) || "default";
    for (let i = 2; profiles[id]; i++) id = `${normalize(stem).slice(0, 36)}-${i}`;
    profiles[id] = { label: c.file, files: [c.file], projectName: c.project && PROJECT_NAME.test(c.project) ? c.project : normalize(path.basename(repo)), services: [], stop: "stop" };
  }
  const def = usable.find((c) => !c.prod) ?? usable[0]!;
  const defId = Object.keys(profiles).find((id) => profiles[id]!.files[0] === def.file)!;
  return { version: 1, default: defId, profiles };
}

export const isProd = (p: Profile) => p.files.some((f) => PROD.test(f)) || PROD.test(p.projectName);

// ---- lifecycle

const base = (p: Profile, repo: string) => ["compose", "-p", p.projectName, ...p.files.flatMap((f) => ["-f", safePath(repo, f)])];

/** compose ps prints one JSON object per line (or one array on older versions). */
function psRows(out: string): Record<string, unknown>[] {
  const t = out.trim();
  if (!t) return [];
  if (t.startsWith("[")) return JSON.parse(t);
  return t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const busy = new Map<string, Action>();
const lastError = new Map<string, string>();
const key = (project: string, id: string) => `${project}\0${id}`;

export function reduce(rows: ServiceState[], wanted: string[]): StackState {
  if (!rows.length) return "stopped";
  if (rows.some((r) => r.state === "restarting" || r.state === "created" || r.health === "starting")) return "starting";
  const running = rows.filter((r) => r.state === "running");
  if (!running.length) return rows.some((r) => r.exitCode !== 0) ? "error" : "stopped";
  const missing = wanted.filter((w) => !running.some((r) => r.service === w));
  return missing.length || running.length < rows.length || rows.some((r) => r.health === "unhealthy") ? "partial" : "running";
}

export async function status(project: string, id: string, p: Profile, repo: string): Promise<StackStatus> {
  const out = await dockerRun([...base(p, repo), "ps", "-a", "--format", "json"], 15_000);
  const all = psRows(out).map((r): ServiceState => ({
    service: String(r.Service ?? ""),
    container: String(r.Name ?? ""),
    state: String(r.State ?? ""),
    health: String(r.Health ?? ""),
    exitCode: Number(r.ExitCode ?? 0),
    ports: (Array.isArray(r.Publishers) ? r.Publishers : []).flatMap((x: Record<string, unknown>) => {
      const target = portNum(x.TargetPort);
      return target ? [{ target, published: portNum(x.PublishedPort), hostIp: typeof x.URL === "string" && x.URL ? x.URL : null }] : [];
    }),
  }));
  const rows = p.services.length ? all.filter((r) => p.services.includes(r.service)) : all;
  const action = busy.get(key(project, id)) ?? null;
  const state: StackState = action === "stop" ? "stopping" : action ? "starting" : reduce(rows, p.services);
  return { state, services: rows, busy: action, lastError: lastError.get(key(project, id)) ?? null };
}

/** argv for one action. `down` never takes -v: volumes (the project's data) are only removed by hand. */
export function actionArgs(action: Action, p: Profile, repo: string): string[] {
  const b = base(p, repo);
  if (action === "up") return [...b, "up", "-d", ...p.services];
  if (action === "restart") return [...b, "restart", ...p.services];
  return p.stop === "down" && !p.services.length ? [...b, "down"] : [...b, "stop", ...p.services];
}

/** Starts the action in the background (pulls and builds take minutes); status() reports it while it runs. */
export function act(project: string, id: string, p: Profile, repo: string, action: Action): { started: Action } {
  const k = key(project, id);
  if (busy.has(k)) throw httpError(409, `This profile is already running "${busy.get(k)}"`);
  const args = actionArgs(action, p, repo);
  busy.set(k, action);
  lastError.delete(k);
  void dockerRun(args, 20 * 60_000)
    .catch((e) => void lastError.set(k, (e as Error).message))
    .finally(() => busy.delete(k));
  return { started: action };
}

/** The last lines of one service's logs (or every service's). */
export function logs(p: Profile, repo: string, service?: string): Promise<string> {
  if (service && !SERVICE.test(service)) throw httpError(400, `Invalid service name: ${service}`);
  return dockerRun([...base(p, repo), "logs", "--no-color", "--timestamps", "--tail", "300", ...(service ? [service] : [])], 30_000);
}

/** Whether the active Docker context talks to this machine (unix socket / named pipe) or to a remote engine. */
export async function contextIsLocal(): Promise<boolean> {
  const host = (await dockerRun(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], 8000).catch(() => "")).trim();
  return !host || /^(unix|npipe):\/\//.test(host);
}
