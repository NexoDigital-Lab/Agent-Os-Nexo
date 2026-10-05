import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot } from "../core/paths.ts";
import { enabledTools, folder, readConfig } from "../core/config.ts";
import { writeJson } from "../core/fsx.ts";
import { listConnections, type Connection } from "../core/connections.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { generateAdapters } from "../core/adapters.ts";
import { loadPermissions } from "../core/permissions.ts";
import { listProjectDirs, refreshAdapters, validateName } from "../core/projects.ts";

export interface ConnectOptions {
  root?: string;
  description?: string;
  command?: string;
  args?: string;
  env?: string[];
  remote?: boolean;
  tools?: string;
}

function parseEnv(pairs: string[] = []): Record<string, string> {
  const env: Record<string, string> = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i <= 0) throw new Error(`--env expects KEY=VALUE, got "${pair}"`);
    env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return env;
}

export function connect(name: string | undefined, opts: ConnectOptions): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const library = folder(root, config, "library");

  if (!name) {
    const list = listConnections(library);
    if (!list.length) return "No connections yet. Add one with `nexo connect <name> --command <cmd>`.";
    return list.map((c) => `${c.name} (${c.type}) → ${c.tools.join(", ") || "no AI"} — ${c.description}`).join("\n");
  }
  validateName(name);
  if (!opts.remote && !opts.command) {
    throw new Error("Pass --command (and --args) for a local MCP server, or --remote for a connector managed elsewhere.");
  }
  const file = join(library, "connections", `${name}.json`);
  const existed = existsSync(file);
  const connection: Connection = {
    name,
    description: opts.description ?? "",
    type: opts.remote ? "remote" : "mcp",
    tools: (opts.tools ? opts.tools.split(",").map((t) => t.trim()) : enabledTools(config)) as Connection["tools"],
    owner: "user",
    ...(opts.remote
      ? {}
      : { command: opts.command, args: opts.args ? opts.args.split(",") : [], env: parseEnv(opts.env) }),
  };
  writeJson(file, connection);
  buildLibraryIndex(library);
  generateAdapters(root, config, root, loadPermissions(join(library, "permissions.json")));
  for (const dir of listProjectDirs(root, config)) refreshAdapters(root, config, dir);
  return `${existed ? "Updated" : "Added"} connection "${name}" (${connection.type}) for ${connection.tools.join(", ") || "no AI"}. Credentials stay in library/connections/ and are never versioned.`;
}
