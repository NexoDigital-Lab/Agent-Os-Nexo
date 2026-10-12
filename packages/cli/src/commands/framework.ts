// nexo framework: install and manage third-party agent frameworks in frameworks/ (core/frameworks.ts has the rules).
// Every process call (npm) goes through the injectable Runner, so tests never run a real npm.
import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { folder, readConfig, writeConfig, type EnvironmentConfig } from "../core/config.ts";
import { ensureDir, isDir } from "../core/fsx.ts";
import {
  declaredKind, defaultFramework, detectContributions, kindOf, loadFrameworks, NEXO_METHOD, packageFacts, parseSource, saveManifest,
  validateFrameworkName, type Framework, type Run,
} from "../core/frameworks.ts";
import { describeJson, instructionsText, materializePlugin } from "../core/frameworkplugin.ts";
import { defaultRunner } from "../core/osruntime.ts";
import { pluginDir } from "../core/frameworkplugin.ts";
import { findRoot } from "../core/paths.ts";
import { refreshAll } from "../core/projects.ts";

export interface FrameworkOptions {
  root?: string;
  name?: string;
  hooks?: boolean;
  json?: boolean;
}

const USAGE = `Usage: nexo framework add <npm:<pkg>@<exact version>|path:<dir>> [--name <n>]
       nexo framework list [--json]
       nexo framework remove <name>
       nexo framework enable|disable <name>
       nexo framework enable|disable <name> --hooks
       nexo framework default <name|nexo>
       nexo framework plugin <name>
       nexo framework instructions <name>`;


function describe(fw: Framework, config: EnvironmentConfig): string {
  const where = !fw.enabled ? "off" : fw.kind === "tool" ? "on (tool)" : defaultFramework(config) === fw.name ? "available, the default method" : "available";
  const c = fw.contributes;
  const hooks = Object.values(c.hooks).reduce((n, l) => n + l.length, 0);
  const parts = [`${c.skills.length} skills`, `${c.agents.length} agents`, `${c.commands.length} commands`, `${Object.keys(c.mcpServers).length} MCP servers`, `${c.instructions.length} instruction files`];
  const hookText = hooks ? `${hooks} hooks (${fw.hooksApproved ? "approved" : "not approved"})` : "no hooks";
  return `${fw.name} ${fw.version} ${fw.kind} [${fw.managed === "external" ? "external" : "managed by nexo"}] ${fw.source} — ${where}; ${parts.join(", ")}; ${hookText}`;
}

function install(root: string, config: EnvironmentConfig, source: string, opts: FrameworkOptions, run: Run): string {
  const parsed = parseSource(source);
  const defaultName = parsed.kind === "npm" ? parsed.pkg.replace(/^@[^/]+\//, "") : parsed.dir.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const name = opts.name ?? defaultName.toLowerCase();
  validateFrameworkName(name);
  const dir = join(folder(root, config, "frameworks"), name);
  if (existsSync(dir)) throw new Error(`Framework "${name}" already exists. Remove it first, or pass --name.`);

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
    const contributes = detectContributions(contentRoot);
    const fw: Framework = {
      name,
      source: parsed.kind === "npm" ? `npm:${parsed.pkg}@${parsed.version}` : `path:${parsed.dir}`,
      version: parsed.kind === "npm" ? parsed.version : String(facts.version ?? "unknown"),
      license: String(facts.license ?? "unknown"),
      // A path: framework belongs to whoever installed it: Nexo only references it.
      managed: parsed.kind === "npm" ? "nexo" : "external",
      kind: "method",
      enabled: false, // adding never activates anything: enable it, then pick it per tab or make it the default
      hooksApproved: false,
      root: rootField,
      contributes,
      dir,
      contentRoot,
    };
    fw.kind = kindOf(contributes, declaredKind(contentRoot));
    saveManifest(fw);
    refreshAll(root, config);
    const hooks = Object.values(fw.contributes.hooks).reduce((n, l) => n + l.length, 0);
    return `Added framework ${describe(fw, config)}. It is off: \`nexo framework enable ${name}\` makes it available.${hooks ? `\nIts ${hooks} hooks run commands on every tool call and stay off: review them in ${join(dir, "framework.json")}, then \`nexo framework enable ${name} --hooks\`.` : ""}`;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true }); // never leave a half-installed framework behind
    throw error;
  }
}

function setDefault(root: string, config: EnvironmentConfig, name: string): void {
  if (name === NEXO_METHOD) delete config.framework;
  else config.framework = name;
  writeConfig(root, config);
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
      if (opts.json) return JSON.stringify({ default: defaultFramework(config), frameworks: frameworks.map((f) => describeJson(f, config)), broken }, null, 2);
      const lines = frameworks.map((f) => describe(f, config));
      for (const b of broken) lines.push(`${b} — unreadable framework.json (fix or remove frameworks/${b}/)`);
      return lines.length ? lines.join("\n") : "No frameworks yet. Add one with `nexo framework add npm:<pkg>@<version>` or `path:<dir>`.";
    }
    case "remove": {
      const fw = find(args[0]);
      // npm: its folder (with node_modules) goes. path: the folder only holds the manifest; the referenced directory is never touched.
      rmSync(fw.dir, { recursive: true, force: true });
      rmSync(pluginDir(root, config, fw.name), { recursive: true, force: true });
      if (defaultFramework(config) === fw.name) setDefault(root, config, NEXO_METHOD);
      refreshAll(root, config);
      return fw.managed === "external" ? `Forgot framework ${fw.name}; ${fw.contentRoot} was not touched.` : `Removed framework ${fw.name}.`;
    }
    case "enable":
    case "disable": {
      const fw = find(args[0]);
      const on = sub === "enable";
      if (opts.hooks) {
        fw.hooksApproved = on;
      } else {
        fw.enabled = on;
        if (!on && defaultFramework(config) === fw.name) setDefault(root, config, NEXO_METHOD); // a disabled method cannot stay the default
      }
      saveManifest(fw);
      refreshAll(root, config);
      return `${on ? "Enabled" : "Disabled"} ${opts.hooks ? "the hooks of " : ""}${fw.name}.`;
    }
    case "default": {
      const name = args[0];
      if (!name) return `The default method is ${defaultFramework(config)}.`;
      if (name !== NEXO_METHOD) {
        const fw = find(name);
        if (fw.kind !== "method") throw new Error(`"${name}" is a tool, not a method: tools are always on while enabled.`);
        if (!fw.enabled) throw new Error(`Enable "${name}" first: \`nexo framework enable ${name}\`.`);
      }
      setDefault(root, config, name);
      refreshAll(root, config);
      return name === NEXO_METHOD ? "The default method is Nexo's own." : `The default method is ${name}.`;
    }
    case "plugin": {
      const fw = find(args[0]);
      if (!fw.enabled) throw new Error(`"${fw.name}" is not enabled: \`nexo framework enable ${fw.name}\`.`);
      return materializePlugin(root, config, fw);
    }
    case "instructions":
      return instructionsText(find(args[0]));
    default:
      throw new Error(USAGE);
  }
}
