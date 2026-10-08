// nexo framework: install and manage third-party agent frameworks in frameworks/ (core/frameworks.ts has the rules).
// Every process call (npm) goes through the injectable Runner, so tests never run a real npm.
import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { generateAdapters } from "../core/adapters.ts";
import { folder, readConfig, type EnvironmentConfig } from "../core/config.ts";
import { ensureDir, isDir } from "../core/fsx.ts";
import {
  detectContributions, loadFrameworks, packageFacts, parseSource, saveManifest, validateFrameworkName,
  type Framework, type Run,
} from "../core/frameworks.ts";
import { defaultRunner } from "../core/osruntime.ts";
import { findRoot } from "../core/paths.ts";
import { loadPermissions } from "../core/permissions.ts";
import { listProjectDirs, refreshAdapters } from "../core/projects.ts";

export interface FrameworkOptions {
  root?: string;
  name?: string;
  project?: string;
  hooks?: boolean;
}

const USAGE = `Usage: nexo framework add <npm:<pkg>@<exact version>|path:<dir>> [--name <n>] [--project <id>]
       nexo framework list
       nexo framework remove <name>
       nexo framework enable|disable <name> [--project <id>]
       nexo framework enable|disable <name> --hooks`;

/** Regenerates every AI's files, so a change to a framework applies at once. */
function refresh(root: string, config: EnvironmentConfig): void {
  generateAdapters(root, config, root, loadPermissions(join(folder(root, config, "library"), "permissions.json")));
  for (const dir of listProjectDirs(root, config)) refreshAdapters(root, config, dir);
}

function describe(fw: Framework): string {
  const where = fw.enabled.global ? "everywhere" : fw.enabled.projects.length ? `in ${fw.enabled.projects.join(", ")}` : "off";
  const c = fw.contributes;
  const hooks = Object.values(c.hooks).reduce((n, l) => n + l.length, 0);
  const parts = [`${c.skills.length} skills`, `${c.agents.length} agents`, `${c.commands.length} commands`, `${Object.keys(c.mcpServers).length} MCP servers`, `${c.instructions.length} instruction files`];
  const hookText = hooks ? `${hooks} hooks (${fw.hooksApproved ? "approved" : "not approved"})` : "no hooks";
  return `${fw.name} ${fw.version} [${fw.managed === "external" ? "external" : "managed by nexo"}] ${fw.source} — ${where}; ${parts.join(", ")}; ${hookText}`;
}

function install(root: string, config: EnvironmentConfig, source: string, opts: FrameworkOptions, run: Run): string {
  const parsed = parseSource(source);
  const defaultName = parsed.kind === "npm" ? parsed.pkg.replace(/^@[^/]+\//, "") : parsed.dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const name = opts.name ?? defaultName.toLowerCase();
  validateFrameworkName(name);
  const dir = join(folder(root, config, "frameworks"), name);
  if (existsSync(dir)) throw new Error(`Framework "${name}" already exists. Remove it first, or pass --name.`);
  if (opts.project && !isDir(join(folder(root, config, "projects"), opts.project))) throw new Error(`No project "${opts.project}" under projects/.`);

  let contentRoot: string;
  let rootField: string;
  try {
    ensureDir(dir);
    if (parsed.kind === "npm") {
      // Exact version, no lifecycle scripts (preinstall/postinstall of the package and of its dependencies never run).
      run("npm", ["install", "--prefix", dir, "--ignore-scripts", "--no-audit", "--no-fund", `${parsed.pkg}@${parsed.version}`], dir);
      contentRoot = join(dir, "node_modules", ...parsed.pkg.split("/"));
      rootField = relative(dir, contentRoot).replace(/\\/g, "/");
    } else {
      if (!isDir(parsed.dir)) throw new Error(`${parsed.dir} is not a folder.`);
      contentRoot = parsed.dir;
      rootField = parsed.dir;
    }
    if (!isDir(contentRoot)) throw new Error(`The install did not produce ${contentRoot}.`);
    const facts = packageFacts(contentRoot);
    const fw: Framework = {
      name,
      source: parsed.kind === "npm" ? `npm:${parsed.pkg}@${parsed.version}` : `path:${parsed.dir}`,
      version: parsed.kind === "npm" ? parsed.version : String(facts.version ?? "unknown"),
      license: String(facts.license ?? "unknown"),
      // A path: framework belongs to whoever installed it: Nexo only references it.
      managed: parsed.kind === "npm" ? "nexo" : "external",
      enabled: { global: !opts.project, projects: opts.project ? [opts.project] : [] },
      hooksApproved: false,
      root: rootField,
      contributes: detectContributions(contentRoot),
      dir,
      contentRoot,
    };
    saveManifest(fw);
    refresh(root, config);
    const hooks = Object.values(fw.contributes.hooks).reduce((n, l) => n + l.length, 0);
    return `Added framework ${describe(fw)}.${hooks ? `\nIts ${hooks} hooks run commands on every tool call and stay off: review them in ${join(dir, "framework.json")}, then \`nexo framework enable ${name} --hooks\`.` : ""}`;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true }); // never leave a half-installed framework behind
    throw error;
  }
}

export function framework(sub: string | undefined, args: string[], opts: FrameworkOptions, run: Run = defaultRunner): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const { frameworks, broken } = loadFrameworks(root, config);
  const find = (name: string | undefined): Framework => {
    const fw = frameworks.find((f) => f.name === name);
    if (!fw) throw new Error(name ? `No framework "${name}". See \`nexo framework list\`.` : USAGE);
    return fw;
  };

  switch (sub) {
    case "add":
      if (!args[0]) throw new Error(USAGE);
      return install(root, config, args[0], opts, run);
    case undefined:
    case "list": {
      const lines = frameworks.map(describe);
      for (const b of broken) lines.push(`${b} — unreadable framework.json (fix or remove frameworks/${b}/)`);
      return lines.length ? lines.join("\n") : "No frameworks yet. Add one with `nexo framework add npm:<pkg>@<version>` or `path:<dir>`.";
    }
    case "remove": {
      const fw = find(args[0]);
      // npm: its folder (with node_modules) goes. path: the folder only holds the manifest; the referenced directory is never touched.
      rmSync(fw.dir, { recursive: true, force: true });
      refresh(root, config);
      return fw.managed === "external" ? `Forgot framework ${fw.name}; ${fw.contentRoot} was not touched.` : `Removed framework ${fw.name}.`;
    }
    case "enable":
    case "disable": {
      const fw = find(args[0]);
      const on = sub === "enable";
      if (opts.hooks) {
        fw.hooksApproved = on;
      } else if (opts.project) {
        if (!isDir(join(folder(root, config, "projects"), opts.project))) throw new Error(`No project "${opts.project}" under projects/.`);
        fw.enabled.projects = on ? [...new Set([...fw.enabled.projects, opts.project])] : fw.enabled.projects.filter((p) => p !== opts.project);
      } else {
        fw.enabled.global = on;
      }
      saveManifest(fw);
      refresh(root, config);
      return `${on ? "Enabled" : "Disabled"} ${opts.hooks ? "the hooks of " : ""}${fw.name}${opts.project && !opts.hooks ? ` in ${opts.project}` : ""}.`;
    }
    default:
      throw new Error(USAGE);
  }
}
