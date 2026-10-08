// nexo import <tool>: bring what the user already set up in another AI (MCP servers, command and file permissions)
// into the library, so every AI gets it. Shows the plan; `--apply` writes it. Never weakens a rule: when the library
// already decides a pattern more strictly, that stays. Env values are stored like `nexo connect` stores them and
// never printed.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { enabledTools, folder, readConfig } from "../core/config.ts";
import { generateAdapters } from "../core/adapters.ts";
import { writeJson } from "../core/fsx.ts";
import { IMPORTABLE, readTool, type ImportTool, type ImportedRule } from "../core/importers.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { editPermissions, setRule } from "../core/permedit.ts";
import { DECISIONS, loadPermissions, type Decision, type Permissions } from "../core/permissions.ts";
import { findRoot } from "../core/paths.ts";
import { listProjectDirs, refreshAdapters } from "../core/projects.ts";
import type { Connection } from "../core/connections.ts";

export interface ImportOptions {
  root?: string;
  apply?: boolean;
  /** The home folder to read the tool's config from (default: yours). */
  from?: string;
}

const STRICTNESS: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

/** "sudo*" and "sudo *" name the same rule here: the trailing wildcard and the space before it are ignored. */
const same = (a: string, b: string) => a.replace(/\s*\*$/, "").trim() === b.replace(/\s*\*$/, "").trim();

/** The strictest decision the library already gives this pattern, or null. */
function current(perms: Permissions, rule: ImportedRule): Decision | null {
  const rules = rule.area === "commands" ? perms.commands : rule.area === "files.edit" ? perms.files?.edit : perms.files?.read;
  return [...DECISIONS].reverse().find((d) => rules?.[d]?.some((p) => same(p, rule.pattern))) ?? null;
}

const connectionName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 60) || "server";

export function importTool(tool: string | undefined, opts: ImportOptions): string {
  if (!IMPORTABLE.includes(tool as ImportTool)) throw new Error(`Usage: nexo import <${IMPORTABLE.join("|")}> [--apply]`);
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const library = folder(root, config, "library");
  const globalFile = join(library, "permissions.json");
  const found = readTool(tool as ImportTool, opts.from ?? homedir(), root);
  if (!found.sources.length) return `Nothing to import: no ${tool} configuration found in ${opts.from ?? "your home folder"}.`;

  const perms = loadPermissions(globalFile);
  const lines = [`From ${found.sources.join(", ")}:`];
  const servers = found.servers.map((s) => ({ ...s, name: connectionName(s.name), exists: existsSync(join(library, "connections", `${connectionName(s.name)}.json`)) }));
  const add = servers.filter((s) => !s.exists);
  for (const s of servers) {
    const env = Object.keys(s.env);
    lines.push(`  ${s.exists ? "= " : "+ "}connection ${s.name}: ${s.command} ${s.args.join(" ")}`.trimEnd() + (env.length ? ` (env: ${env.join(", ")})` : "") + (s.exists ? " — already in the library, kept" : ""));
  }
  const rules: ImportedRule[] = [];
  const seen = new Set<string>();
  for (const r of found.rules) {
    const key = `${r.area}\u0000${r.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const now = current(perms, r);
    if (now && STRICTNESS[now] >= STRICTNESS[r.decision]) {
      lines.push(`  = ${r.area} ${r.decision} "${r.pattern}" — the library already says ${now}`);
      continue;
    }
    if (now) lines.push(`  ~ ${r.area} "${r.pattern}": ${now} → ${r.decision} (stricter)`);
    else lines.push(`  + ${r.area} ${r.decision} "${r.pattern}"`);
    rules.push(r);
  }
  for (const s of found.skipped) lines.push(`  - skipped: ${s}`);
  if (!add.length && !rules.length) return [...lines, "Nothing new to bring in."].join("\n");
  if (!opts.apply) return [...lines, `Run again with --apply to write ${add.length} connection(s) and ${rules.length} rule(s).`].join("\n");

  for (const s of add) {
    const connection: Connection = { name: s.name, description: `Imported from ${tool}`, type: "mcp", command: s.command, args: s.args, env: s.env, tools: enabledTools(config), owner: "user" };
    writeJson(join(library, "connections", `${s.name}.json`), connection);
  }
  if (rules.length) editPermissions(globalFile, (p) => { for (const r of rules) setRule(p, r.area, r.decision, r.pattern); });
  buildLibraryIndex(library);
  generateAdapters(root, config, root, loadPermissions(globalFile));
  for (const dir of listProjectDirs(root, config)) refreshAdapters(root, config, dir);
  return [...lines, `Imported ${add.length} connection(s) and ${rules.length} rule(s); every AI's files refreshed.`].join("\n");
}
