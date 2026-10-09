// nexo memory: agent memory with Engram (third party, MIT), installed pinned and reached only through Nexo's proxy.
// core/engram.ts installs it; core/memoryproxy.ts is the proxy the AIs' `memory` connection runs.
import { existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { folder, readConfig, writeConfig, type EnvironmentConfig } from "../core/config.ts";
import {
  binaryPath, defaultFetcher, engramPaths, folderBytes, installedVersions, installEngram, MEMORY_CONNECTION, pruneVersions, readPin,
  removeMemoryConnection, writeMemoryConnection, type EngramPin, type Fetcher,
} from "../core/engram.ts";
import { runProxy, startEngram, type ProxyIo } from "../core/memoryproxy.ts";
import { findRoot } from "../core/paths.ts";
import { loadPermissions, mergePermissions, type Decision } from "../core/permissions.ts";
import { refreshAll } from "../core/projects.ts";

export interface MemoryOptions {
  root?: string;
  ai?: string;
  json?: boolean;
}

const USAGE = `Usage: nexo memory [status] [--json]
       nexo memory install|update|remove
       nexo memory mcp --ai <claude|codex|gemini|opencode>   (run by the AIs' memory connection)`;

const THIRD_PARTY = "Engram (third party, MIT, github.com/Gentleman-Programming/engram)";

/** The Engram project for a working folder: the Nexo project it is in (`shop`, `acme-ws-api`), else `environment`. */
export function memoryProject(root: string, config: EnvironmentConfig, cwd: string): string {
  const rel = relative(folder(root, config, "projects"), cwd).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return "environment";
  const parts = rel.split("/").filter(Boolean);
  return (parts[0]!.endsWith("-ws") && parts[1] ? parts.slice(0, 2) : parts.slice(0, 1)).join("-").toLowerCase();
}

/** Whether `ai` may write memories: connections.memory.write (else "*"); OpenCode cannot ask, so "ask" reads only. */
export function memoryWrites(root: string, config: EnvironmentConfig, cwd: string, ai: string): boolean {
  let perms = loadPermissions(join(folder(root, config, "library"), "permissions.json"));
  const project = memoryProjectDir(root, config, cwd);
  if (project) perms = mergePermissions(perms, loadPermissions(join(project, "context", "permissions.json")));
  const c = perms.connections ?? {};
  const write: Decision = c[MEMORY_CONNECTION]?.write ?? c["*"]?.write ?? perms.default ?? "ask";
  return write === "allow" || (write === "ask" && ai !== "opencode");
}

function memoryProjectDir(root: string, config: EnvironmentConfig, cwd: string): string | null {
  const name = memoryProject(root, config, cwd);
  if (name === "environment") return null;
  const parts = relative(folder(root, config, "projects"), cwd).replace(/\\/g, "/").split("/").filter(Boolean);
  const dir = join(folder(root, config, "projects"), ...(parts[0]!.endsWith("-ws") && parts[1] ? parts.slice(0, 2) : parts.slice(0, 1)));
  return existsSync(join(dir, "AGENTS.md")) ? dir : null;
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
  writeMemoryConnection(folder(root, config, "library"));
  writeConfig(root, { ...config, memory: "engram" });
  refreshAll(root, readConfig(root));
  return [
    `${downloaded ? `${verb === "update" ? "Updated to" : "Installed"}` : "Already installed:"} ${THIRD_PARTY} ${pin.version} (SHA-256 verified against Nexo's pin).`,
    `  binary: ${binary}${old.length ? ` (removed ${old.join(", ")})` : ""}`,
    `  data: ${paths.data}`,
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
      return `Agent memory off: removed Engram ${gone.join(", ") || "(nothing installed)"} and the "${MEMORY_CONNECTION}" connection. The memories stay in ${paths.data}.`;
    }
    case "mcp": {
      const ai = opts.ai ?? "";
      if (!/^(claude|codex|gemini|opencode)$/.test(ai)) throw new Error(USAGE);
      if (config.memory !== "engram") throw new Error("Agent memory is off (`nexo memory install`).");
      const paths = engramPaths(root, config);
      const binary = binaryPath(paths, pin.version);
      if (!existsSync(binary)) throw new Error(`Engram ${pin.version} is not installed: run \`nexo memory update\`.`);
      const cwd = process.cwd();
      const policy = { ai, project: memoryProject(root, config, cwd), writes: memoryWrites(root, config, cwd, ai) };
      return runProxy(policy, binary, paths.data, deps.io ?? { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, start: startEngram(binary) });
    }
    default:
      throw new Error(USAGE);
  }
}
