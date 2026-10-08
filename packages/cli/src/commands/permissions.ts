// nexo permissions: show and change what agents may do alone (library/permissions.json, or a project's
// context/permissions.json), one rule at a time, validated — then every AI's own files are regenerated so the
// change applies at once. Agents run it only after asking the user (environment AGENTS.md, invariant 3).
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { folder, readConfig } from "../core/config.ts";
import { generateAdapters } from "../core/adapters.ts";
import { editPermissions, isDecision, isRuleArea, removeRule, RULE_AREAS, setDecision, setRule } from "../core/permedit.ts";
import { loadPermissions, mergePermissions, type Permissions } from "../core/permissions.ts";
import { findRoot } from "../core/paths.ts";
import { listProjectDirs, refreshAdapters } from "../core/projects.ts";

export interface PermissionsOptions {
  root?: string;
  /** A project id under projects/ ("shop", "api-ws/web"): its context/permissions.json. */
  project?: string;
  json?: boolean;
}

const USAGE = `Usage: nexo permissions [show] [--project <id>] [--json]
       nexo permissions allow|ask|deny <${RULE_AREAS.join("|")}> <pattern> [--project <id>]
       nexo permissions remove <${RULE_AREAS.join("|")}> <pattern> [--project <id>]
       nexo permissions set <default|os.<action>|connections.<name>.<action>> <allow|ask|deny> [--project <id>]`;

function render(perms: Permissions): string {
  const lines = [`default: ${perms.default ?? "ask"}`];
  const rules = (label: string, r?: Partial<Record<string, string[]>>) => {
    for (const d of ["allow", "ask", "deny"]) if (r?.[d]?.length) lines.push(`${label} ${d}: ${r[d]!.join(", ")}`);
  };
  rules("files.read", perms.files?.read);
  rules("files.edit", perms.files?.edit);
  rules("commands", perms.commands);
  for (const [name, actions] of Object.entries(perms.connections ?? {})) {
    lines.push(`connections.${name}: ${Object.entries(actions).map(([a, d]) => `${a} ${d}`).join(", ")}`);
  }
  if (perms.os && Object.keys(perms.os).length) lines.push(`os: ${Object.entries(perms.os).map(([a, d]) => `${a} ${d}`).join(", ")}`);
  return lines.join("\n");
}

export function permissions(action: string | undefined, args: string[], opts: PermissionsOptions): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const globalFile = join(folder(root, config, "library"), "permissions.json");
  let projectDir: string | null = null;
  if (opts.project) {
    const id = opts.project.replace(/\\/g, "/");
    if (!/^[a-z0-9][a-z0-9._-]*(-ws\/[a-z0-9][a-z0-9._-]*)?$/.test(id)) throw new Error(`Invalid project id "${opts.project}".`);
    projectDir = join(folder(root, config, "projects"), ...id.split("/"));
    if (!existsSync(join(projectDir, "AGENTS.md"))) throw new Error(`No project "${id}" in projects/.`);
  }
  const file = projectDir ? join(projectDir, "context", "permissions.json") : globalFile;
  const where = relative(root, file).replace(/\\/g, "/");

  const refresh = () => {
    if (projectDir) return refreshAdapters(root, config, projectDir);
    generateAdapters(root, config, root, loadPermissions(globalFile));
    for (const dir of listProjectDirs(root, config)) refreshAdapters(root, config, dir);
  };

  const act = action ?? "show";
  switch (act) {
    case "show": {
      const global = loadPermissions(globalFile);
      const effective = projectDir ? mergePermissions(global, loadPermissions(file)) : global;
      if (opts.json) return JSON.stringify(projectDir ? { effective, global, project: loadPermissions(file) } : { effective }, null, 2);
      return `${projectDir ? `Effective for ${opts.project} (global + ${where})` : where}:\n${render(effective)}`;
    }
    case "allow":
    case "ask":
    case "deny": {
      const [area, ...rest] = args;
      const pattern = rest.join(" ");
      if (!isRuleArea(area) || !pattern) throw new Error(USAGE);
      editPermissions(file, (p) => setRule(p, area, act, pattern));
      refresh();
      return `${area} "${pattern.trim()}" → ${act} (${where}). AI files refreshed.`;
    }
    case "remove": {
      const [area, ...rest] = args;
      const pattern = rest.join(" ");
      if (!isRuleArea(area) || !pattern) throw new Error(USAGE);
      let found = false;
      editPermissions(file, (p) => void (found = removeRule(p, area, pattern)));
      if (!found) throw new Error(`${area} has no rule "${pattern.trim()}" in ${where}.`);
      refresh();
      return `${area} "${pattern.trim()}" removed (${where}). AI files refreshed.`;
    }
    case "set": {
      const [key, decision] = args;
      if (!key || !isDecision(decision)) throw new Error(USAGE);
      editPermissions(file, (p) => setDecision(p, key, decision));
      refresh();
      return `${key} → ${decision} (${where}). AI files refreshed.`;
    }
    default:
      throw new Error(USAGE);
  }
}
