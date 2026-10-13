// nexo memory: agent memory with Engram (third party, MIT), installed pinned and reached only through Nexo's proxy.
// core/engram.ts installs it; core/memoryproxy.ts is the proxy the AIs' `memory` connection runs.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, isAbsolute } from "node:path";
import { folder, readConfig, writeConfig, type EnvironmentConfig } from "../core/config.ts";
import {
  binaryPath, defaultFetcher, engramDenyRule, engramPaths, folderBytes, installedVersions, installEngram, MEMORY_CONNECTION, pruneVersions, readPin,
  removeMemoryConnection, writeMemoryConnection, type EngramPaths, type EngramPin, type Fetcher,
} from "../core/engram.ts";
import { readJson, writeJson } from "../core/fsx.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { canonicalProject, runProxy, startEngram, type ProxyIo } from "../core/memoryproxy.ts";
import { findRoot } from "../core/paths.ts";
import { loadPermissions, mergePermissions, type Decision, type Permissions } from "../core/permissions.ts";
import { listProjectDirs, refreshAll } from "../core/projects.ts";

export interface MemoryOptions {
  root?: string;
  ai?: string;
  json?: boolean;
}

const USAGE = `Usage: nexo memory [status] [--json]
       nexo memory install|update|remove
       nexo memory mcp --ai <claude|codex|gemini|opencode>   (run by the AIs' memory connection)`;

const THIRD_PARTY = "Engram (third party, MIT, github.com/Gentleman-Programming/engram)";

/**
 * The Engram project for a working folder: the Nexo project it is in (`shop`, or `acme-ws:api` for a workspace part —
 * `:` is never in a Nexo name, so a part cannot collide with a project called `acme-ws-api`), else `environment`.
 */
export function memoryProject(root: string, config: EnvironmentConfig, cwd: string): string {
  const parts = projectParts(root, config, cwd);
  return parts ? parts.join(":").toLowerCase() : "environment";
}

/** A path with its symlinks resolved (macOS /var → /private/var); a missing tail is kept after its deepest existing folder. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(real(parent), basename(path));
  }
}

/**
 * The project folder `cwd` is in, relative to projects/ (`["shop"]`, `["acme-ws", "api"]`); null outside every project.
 * A workspace's subfolder is a part only when it is a project (has an AGENTS.md), as `listProjectDirs` decides.
 */
function projectParts(root: string, config: EnvironmentConfig, cwd: string): string[] | null {
  const projects = folder(root, config, "projects");
  const rel = relative(real(projects), real(cwd)).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const parts = rel.split("/").filter(Boolean);
  const isPart = parts[0]!.endsWith("-ws") && parts[1] && existsSync(join(projects, parts[0]!, parts[1], "AGENTS.md"));
  return isPart ? parts.slice(0, 2) : parts.slice(0, 1);
}

/** AIs whose own approval prompt covers an MCP tool call, so an "ask" decision can be left to them. */
const ASKS_PER_TOOL = new Set(["claude", "gemini"]);

/** The permissions that apply in `cwd`: the environment's, then its project's. */
function permissionsAt(root: string, config: EnvironmentConfig, cwd: string): Permissions {
  const perms = loadPermissions(join(folder(root, config, "library"), "permissions.json"));
  const project = memoryProjectDir(root, config, cwd);
  return project ? mergePermissions(perms, loadPermissions(join(project, "context", "permissions.json"))) : perms;
}

/** Whether `ai` may do `action` on memory: connections.memory.<action>, else "*", else the default; "ask" only where the AI asks. */
function memoryMay(perms: Permissions, ai: string, action: "read" | "write"): boolean {
  const c = perms.connections ?? {};
  const decision: Decision = c[MEMORY_CONNECTION]?.[action] ?? c["*"]?.[action] ?? perms.default ?? "ask";
  return decision === "allow" || (decision === "ask" && ASKS_PER_TOOL.has(ai));
}

/** Whether `ai` may read memories (connections.memory.read); Codex and OpenCode cannot ask, so "ask" is no for them. */
export function memoryReads(root: string, config: EnvironmentConfig, cwd: string, ai: string): boolean {
  return memoryMay(permissionsAt(root, config, cwd), ai, "read");
}

/** Whether `ai` may write memories (connections.memory.write); Codex and OpenCode cannot ask, so "ask" is no for them. */
export function memoryWrites(root: string, config: EnvironmentConfig, cwd: string, ai: string): boolean {
  return memoryMay(permissionsAt(root, config, cwd), ai, "write");
}

function memoryProjectDir(root: string, config: EnvironmentConfig, cwd: string): string | null {
  const parts = projectParts(root, config, cwd);
  if (!parts) return null;
  const dir = join(folder(root, config, "projects"), ...parts);
  return existsSync(join(dir, "AGENTS.md")) ? dir : null;
}

/** Other project folders whose memory would land in the same Engram project as `name` (Engram folds case, `--` and `__`). */
function sharedMemory(root: string, config: EnvironmentConfig, name: string, own: string | null): string[] {
  const key = canonicalProject(name);
  return listProjectDirs(root, config).filter((dir) => dir !== own && canonicalProject(memoryProject(root, config, dir)) === key);
}

/** Adds the deny rule to library/permissions.json when it is missing (environments made before memory existed); true when added. */
function denyEngramData(root: string, config: EnvironmentConfig, paths: EngramPaths): boolean {
  const file = join(folder(root, config, "library"), "permissions.json");
  if (!existsSync(file)) return false;
  const perms = readJson<Permissions>(file);
  const rule = engramDenyRule(root, paths);
  const deny = perms.files?.read?.deny ?? [];
  if (deny.includes(rule)) return false;
  writeJson(file, { ...perms, files: { ...perms.files, read: { ...perms.files?.read, deny: [...deny, rule] } } });
  return true;
}

/** Newest first, by version number (3.10.0 after 3.9.0). */
function byVersion(a: string, b: string): number {
  const n = (v: string) => v.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
}

function status(root: string, config: EnvironmentConfig, pin: EngramPin, json?: boolean): string {
  const paths = engramPaths(root, config);
  const versions = installedVersions(paths);
  const connected = existsSync(join(folder(root, config, "library"), "connections", `${MEMORY_CONNECTION}.json`));
  const facts = {
    enabled: config.memory === "engram",
    pinned: pin.version,
    installed: versions,
    binary: versions.includes(pin.version) ? binaryPath(paths, pin.version) : null,
    data: paths.data,
    dataBytes: existsSync(paths.data) ? folderBytes(paths.data) : 0,
    connection: connected,
  };
  if (json) return JSON.stringify(facts, null, 2);
  if (!facts.enabled && !versions.length) return `Agent memory is off. \`nexo memory install\` adds ${THIRD_PARTY} ${pin.version}.`;
  const lines = [
    `Agent memory: ${THIRD_PARTY}`,
    `  ${facts.enabled ? "on" : "off"} · pinned ${pin.version} · installed ${versions.join(", ") || "none"}${facts.binary ? "" : " — run `nexo memory update`"}`,
    `  data: ${paths.data} (${Math.round(facts.dataBytes / 1024)} KB)`,
    `  connection "${MEMORY_CONNECTION}": ${connected ? "wired into every enabled AI through `nexo memory mcp`" : "missing — run `nexo memory install`"}`,
  ];
  return lines.join("\n");
}

async function install(root: string, config: EnvironmentConfig, pin: EngramPin, fetcher: Fetcher, verb: "install" | "update"): Promise<string> {
  const paths = engramPaths(root, config);
  const { binary, downloaded } = await installEngram(paths, pin, fetcher);
  const old = pruneVersions(paths, pin.version);
  const library = folder(root, config, "library");
  writeMemoryConnection(library, root);
  const denied = denyEngramData(root, config, paths);
  writeConfig(root, { ...config, memory: "engram" });
  refreshAll(root, readConfig(root));
  buildLibraryIndex(library);
  return [
    `${downloaded ? `${verb === "update" ? "Updated to" : "Installed"}` : "Already installed:"} ${THIRD_PARTY} ${pin.version} (SHA-256 verified against Nexo's pin).`,
    `  binary: ${binary}${old.length ? ` (removed ${old.join(", ")})` : ""}`,
    `  data: ${paths.data}${denied ? ` (agents may not read it: added ${engramDenyRule(root, paths)} to the read deny rules)` : ""}`,
    `  every enabled AI now has the "${MEMORY_CONNECTION}" connection (\`nexo memory mcp\`): project-pinned, no prompts, secrets masked.`,
  ].join("\n");
}

/** What tests swap: the download, the pin (nexo_bases/engram.json) and the proxy's streams and process. */
export interface MemoryDeps {
  fetcher?: Fetcher;
  pin?: EngramPin;
  io?: ProxyIo;
}

export async function memory(action: string | undefined, opts: MemoryOptions, deps: MemoryDeps = {}): Promise<string | number> {
  const root = findRoot(opts.root);
  const pin = deps.pin ?? readPin();
  const config = readConfig(root);
  switch (action ?? "status") {
    case "status":
      return status(root, config, pin, opts.json);
    case "install":
      return install(root, config, pin, deps.fetcher ?? defaultFetcher, "install");
    case "update":
      if (config.memory !== "engram") throw new Error("Agent memory is off: run `nexo memory install`.");
      return install(root, config, pin, deps.fetcher ?? defaultFetcher, "update");
    case "remove": {
      const paths = engramPaths(root, config);
      const gone = pruneVersions(paths, null);
      removeMemoryConnection(folder(root, config, "library"));
      writeConfig(root, { ...config, memory: "none" });
      refreshAll(root, readConfig(root));
      buildLibraryIndex(folder(root, config, "library"));
      return `Agent memory off: removed Engram ${gone.join(", ") || "(nothing installed)"} and the "${MEMORY_CONNECTION}" connection. The memories stay in ${paths.data}.`;
    }
    case "mcp": {
      const ai = opts.ai ?? "";
      if (!/^(claude|codex|gemini|opencode)$/.test(ai)) throw new Error(USAGE);
      if (config.memory !== "engram") throw new Error("Agent memory is off (`nexo memory install`).");
      const paths = engramPaths(root, config);
      const stderr = deps.io?.stderr ?? process.stderr;
      // A newer Nexo may pin a newer Engram than the one installed: keep memory working on the installed one meanwhile.
      const version = installedVersions(paths).includes(pin.version) ? pin.version : installedVersions(paths).sort(byVersion)[0];
      if (!version) throw new Error(`Engram ${pin.version} is not installed: run \`nexo memory update\`.`);
      if (version !== pin.version) stderr.write(`nexo memory mcp: running Engram ${version}; Nexo pins ${pin.version} — run \`nexo memory update\`.\n`);
      const binary = binaryPath(paths, version);
      const cwd = process.cwd();
      const project = memoryProject(root, config, cwd);
      if (project !== "environment") {
        const others = sharedMemory(root, config, project, memoryProjectDir(root, config, cwd));
        if (others.length) throw new Error(`"${project}" would share Engram's memory with ${others.join(", ")} (Engram ignores case, -- and __ in names): rename one of them.`);
      }
      const policy = { ai, project, reads: memoryReads(root, config, cwd, ai), writes: memoryWrites(root, config, cwd, ai) };
      return runProxy(policy, binary, paths.data, deps.io ?? { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, start: startEngram(binary) });
    }
    default:
      throw new Error(USAGE);
  }
}
