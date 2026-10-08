// What agent-os (and `nexo framework list --json`) need from a framework: its description as data, the Claude Code
// plugin folder materialized for it, and the text of its instruction files. Everything stays inside the framework's own
// content root (the manifest paths were already filtered by frameworks.ts; links that leave it are skipped here too).
import { copyFileSync, existsSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, join, relative, isAbsolute, sep } from "node:path";
import { folder, type EnvironmentConfig } from "./config.ts";
import { asObj } from "./coexist.ts";
import { ensureDir, isDir, linkDir, readText, writeJson } from "./fsx.ts";
import { defaultFramework, type Framework } from "./frameworks.ts";

const MAX_INSTRUCTIONS = 200_000;

/** Every `command` string in a hooks block (hook entries nest: event → matcher entry → hooks[]). */
export function hookCommands(hooks: Record<string, unknown[]>): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.command === "string") out.push(o.command);
      walk(o.hooks);
    }
  };
  Object.values(hooks).forEach(walk);
  return out;
}

/** The machine-readable description of one framework (`nexo framework list --json`). */
export function describeJson(fw: Framework, config: EnvironmentConfig) {
  const c = fw.contributes;
  return {
    name: fw.name,
    kind: fw.kind,
    source: fw.source,
    version: fw.version,
    license: fw.license,
    managed: fw.managed,
    enabled: fw.enabled,
    hooksApproved: fw.hooksApproved,
    hookCommands: hookCommands(c.hooks),
    contributions: {
      skills: c.skills,
      agents: c.agents,
      commands: c.commands,
      mcpServers: Object.keys(c.mcpServers),
      instructions: c.instructions,
      hooks: Object.values(c.hooks).reduce((n, l) => n + l.length, 0),
    },
    isDefault: defaultFramework(config) === fw.name,
  };
}

/** Is `file` really inside `base` once links are followed? */
function contained(base: string, file: string): boolean {
  try {
    const rel = relative(realpathSync(base), realpathSync(file));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("..");
  } catch {
    return false;
  }
}

const subst = <T>(value: T, contentRoot: string): T =>
  JSON.parse(JSON.stringify(value).split("${CLAUDE_PLUGIN_ROOT}").join(contentRoot.replace(/\\/g, "/"))) as T;

export function pluginDir(root: string, config: EnvironmentConfig, name: string): string {
  return join(folder(root, config, "state"), "nexo", "plugins", name);
}

/**
 * A Claude Code plugin folder for the framework at <state>/nexo/plugins/<name>/, rebuilt from scratch each call (so it
 * is idempotent and follows the manifest): plugin.json, links to its skills, copies of its agents and commands, its
 * hooks only once approved, and its local MCP servers with ${CLAUDE_PLUGIN_ROOT} resolved to the framework's folder.
 */
export function materializePlugin(root: string, config: EnvironmentConfig, fw: Framework): string {
  const dir = pluginDir(root, config, fw.name);
  rmSync(dir, { recursive: true, force: true });
  ensureDir(join(dir, ".claude-plugin"));
  writeJson(join(dir, ".claude-plugin", "plugin.json"), { name: fw.name, version: fw.version, description: `Framework ${fw.name} (third-party), from Nexo` });
  const at = (rel: string) => join(fw.contentRoot, rel);
  const skills = fw.contributes.skills.filter((r) => isDir(at(r)) && contained(fw.contentRoot, at(r)));
  if (skills.length) ensureDir(join(dir, "skills"));
  for (const rel of skills) linkDir(at(rel), join(dir, "skills", basename(rel)));
  for (const [sub, list] of [["agents", fw.contributes.agents], ["commands", fw.contributes.commands]] as const) {
    for (const rel of list) {
      if (!existsSync(at(rel)) || !statSync(at(rel)).isFile() || !contained(fw.contentRoot, at(rel))) continue;
      ensureDir(join(dir, sub));
      copyFileSync(at(rel), join(dir, sub, basename(rel)));
    }
  }
  const hookCount = Object.values(fw.contributes.hooks).reduce((n, l) => n + l.length, 0);
  if (fw.hooksApproved && hookCount) {
    ensureDir(join(dir, "hooks"));
    writeJson(join(dir, "hooks", "hooks.json"), { hooks: subst(fw.contributes.hooks, fw.contentRoot) });
  }
  const servers = Object.entries(fw.contributes.mcpServers).filter(([, s]) => typeof asObj(s).command === "string");
  if (servers.length) writeJson(join(dir, ".mcp.json"), { mcpServers: subst(Object.fromEntries(servers), fw.contentRoot) });
  return dir;
}

/** The text of the framework's instruction files (contained, capped), each under a heading with its file name. */
export function instructionsText(fw: Framework): string {
  const parts: string[] = [];
  let size = 0;
  for (const rel of fw.contributes.instructions) {
    const file = join(fw.contentRoot, rel);
    if (!existsSync(file) || !statSync(file).isFile() || !contained(fw.contentRoot, file)) continue;
    const text = readText(file).trim();
    if (!text || size + text.length > MAX_INSTRUCTIONS) continue;
    size += text.length;
    parts.push(`## ${rel}\n\n${text}`);
  }
  return parts.join("\n\n");
}
