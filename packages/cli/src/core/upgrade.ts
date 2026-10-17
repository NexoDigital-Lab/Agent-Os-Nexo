// The CLI installed from npm: which package manager put it there (so `nexo self-update` upgrades it the same way), and
// whether a newer version is published (checked at most once a day, cached in .state/nexo/update-check.json).
import { existsSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { readJson, writeJson } from "./fsx.ts";

export const CLI_PACKAGE = "@nexodigital/nexo";
const REGISTRY = `https://registry.npmjs.org/${CLI_PACKAGE.replace("/", "%2f")}/latest`;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Manager = "npm" | "pnpm" | "yarn" | "bun";
/** global: a package manager's global install; npx: a one-off run (npx, bunx, pnpm dlx); local: a project's
 * dependency (its package.json decides the version); other: a checkout or a self-update copy. */
export type Install = { kind: "global"; manager: Manager } | { kind: "npx" } | { kind: "local" } | { kind: "other" };

/** How the running CLI was installed, from where its entry file really lives. */
export function installKind(entry: string | undefined = process.argv[1]): Install {
  if (!entry) return { kind: "other" };
  let real = entry;
  try {
    real = realpathSync(entry);
  } catch {}
  const p = real.split(sep).join("/");
  if (!p.includes("/node_modules/@nexodigital/nexo/")) return { kind: "other" };
  if (/\/_npx\/|\/\.pnpm-dlx|\/pnpm\/dlx\/|\/dlx-|\/bunx-/i.test(p)) return { kind: "npx" };
  if (/\/\.bun\/install\/global\//i.test(p)) return { kind: "global", manager: "bun" };
  if (/\/pnpm\/global\//i.test(p)) return { kind: "global", manager: "pnpm" };
  if (/\/yarn\/global\/|\/\.config\/yarn\/global\/|\/yarn\/data\/global\/|\/\.yarn\/global\//i.test(p)) return { kind: "global", manager: "yarn" };
  // npm's global folder: <prefix>/lib/node_modules (POSIX) or %APPDATA%\npm\node_modules (Windows); any other
  // node_modules is a project's.
  if (/\/lib\/node_modules\/@nexodigital\/nexo\/|\/npm\/node_modules\/@nexodigital\/nexo\//i.test(p)) return { kind: "global", manager: "npm" };
  return { kind: "local" };
}

/** The command that upgrades a global install to the latest published version. */
export function upgradeArgs(manager: Manager, spec = `${CLI_PACKAGE}@latest`): string[] {
  if (manager === "yarn") return ["global", "add", spec];
  if (manager === "npm") return ["install", "--global", spec];
  return ["add", "--global", spec];
}

export type Runner = (cmd: string, args: string[]) => number;
/** Runs the package manager in the foreground, its output on the terminal. On Windows managers are .cmd shims: the
 * fixed argv goes through `cmd /d /c` (nothing in it comes from the user). */
export const defaultRunner: Runner = (cmd, args) => {
  const win = process.platform === "win32";
  const r = spawnSync(win ? "cmd" : cmd, win ? ["/d", "/c", cmd, ...args] : args, { stdio: "inherit" });
  return r.status ?? 1;
};

/** x.y.z comparison; a prerelease (x.y.z-…) counts as older than its release. */
export function newer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [core = "", pre] = v.trim().replace(/^v/, "").split("-", 2);
    return { n: core.split(".").map((x) => Number.parseInt(x, 10) || 0), pre: pre !== undefined };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) if ((a.n[i] ?? 0) !== (b.n[i] ?? 0)) return (a.n[i] ?? 0) > (b.n[i] ?? 0);
  return !a.pre && b.pre;
}

type Cache = { checkedAt: number; latest: string | null };
export const cacheFile = (stateDir: string): string => join(stateDir, "nexo", "update-check.json");

/** The cache, or nothing when it is missing or broken (a broken one is simply rewritten by the next check). */
function readCache(stateDir: string): Partial<Cache> {
  try {
    return existsSync(cacheFile(stateDir)) ? readJson<Partial<Cache>>(cacheFile(stateDir)) : {};
  } catch {
    return {};
  }
}

/** The latest version known from the last check, without touching the network. */
export function cachedLatest(stateDir: string): string | null {
  const c = readCache(stateDir);
  return typeof c.latest === "string" ? c.latest : null;
}

export type Fetcher = (url: string, signal: AbortSignal) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
const defaultFetcher: Fetcher = (url, signal) => fetch(url, { signal });

/**
 * The latest published version, asking the registry at most once a day (1.5 s, and a failure counts as a check so an
 * offline machine is not retried on every command). Never throws.
 */
export async function latestVersion(stateDir: string, opts: { now?: number; fetcher?: Fetcher; force?: boolean } = {}): Promise<string | null> {
  const now = opts.now ?? Date.now();
  const file = cacheFile(stateDir);
  const cache = readCache(stateDir);
  if (!opts.force && typeof cache.checkedAt === "number" && now - cache.checkedAt < DAY_MS) return cache.latest ?? null;
  // Anything but a valid answer (offline, 5xx, 429, a captive portal's page) keeps what was known.
  let latest: string | null = cache.latest ?? null;
  try {
    const res = await (opts.fetcher ?? defaultFetcher)(REGISTRY, AbortSignal.timeout(1500));
    const body = res.ok ? ((await res.json()) as { version?: unknown }) : {};
    if (typeof body.version === "string" && /^\d+\.\d+\.\d+/.test(body.version)) latest = body.version;
  } catch {}
  try {
    writeJson(file, { checkedAt: now, latest });
  } catch {}
  return latest;
}

/** One line telling how to upgrade, for the way this CLI was installed. */
export function updateNotice(current: string, latest: string, install: Install = installKind()): string {
  const how = install.kind === "global"
    ? `\`nexo self-update\` (${install.manager} ${upgradeArgs(install.manager).join(" ")})`
    : install.kind === "npx" ? `\`npx ${CLI_PACKAGE}@latest\``
    : install.kind === "local" ? `update ${CLI_PACKAGE} in this project's package.json`
    : "`nexo self-update`";
  return `nexo ${latest} is available (this is ${current}): ${how}`;
}
