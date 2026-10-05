import { join } from "node:path";
import { listDir, readJson } from "./fsx.ts";
import type { Tool } from "./config.ts";

export interface Connection {
  name: string;
  description: string;
  /** "mcp" = local MCP server Nexo configures; "remote" = connector managed elsewhere (e.g. claude.ai). */
  type: "mcp" | "remote";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** AIs this connection is wired into. */
  tools: Tool[];
  owner?: string;
}

export function listConnections(libraryDir: string): Connection[] {
  const dir = join(libraryDir, "connections");
  return listDir(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => readJson<Connection>(join(dir, f)));
}

/** MCP server entries for one tool, in the common `mcpServers` shape. */
export function mcpServersFor(connections: Connection[], tool: Tool): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  for (const c of connections) {
    if (c.type !== "mcp" || !c.command || !c.tools.includes(tool)) continue;
    servers[c.name] = { command: c.command, args: c.args ?? [], env: c.env ?? {} };
  }
  return servers;
}
