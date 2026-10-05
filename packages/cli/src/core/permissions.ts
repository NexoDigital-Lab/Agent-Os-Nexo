import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "./fsx.ts";

export type Decision = "allow" | "ask" | "deny";
export const DECISIONS: readonly Decision[] = ["allow", "ask", "deny"];

export type Rules = Partial<Record<Decision, string[]>>;

export interface Permissions {
  default?: Decision;
  files?: { read?: Rules; edit?: Rules };
  commands?: Rules;
  connections?: Record<string, Partial<Record<"read" | "write" | "delete", Decision>>>;
  os?: Partial<Record<"build" | "restart" | "vault", Decision>>;
}

export const PRESETS = ["strict", "normal", "relaxed"] as const;
export type Preset = (typeof PRESETS)[number];

export function loadPermissions(path: string): Permissions {
  return existsSync(path) ? readJson<Permissions>(path) : {};
}

function mergeRules(base: Rules = {}, over: Rules = {}): Rules {
  const out: Rules = {};
  for (const decision of DECISIONS) {
    const items = [...(base[decision] ?? []), ...(over[decision] ?? [])];
    if (items.length) out[decision] = [...new Set(items)];
  }
  return out;
}

/** Project permissions extend the global ones; on conflicts the stricter decision wins downstream. */
export function mergePermissions(global: Permissions, project: Permissions): Permissions {
  return {
    default: project.default ?? global.default ?? "ask",
    files: {
      read: mergeRules(global.files?.read, project.files?.read),
      edit: mergeRules(global.files?.edit, project.files?.edit),
    },
    commands: mergeRules(global.commands, project.commands),
    connections: { ...global.connections, ...project.connections },
    os: { ...global.os, ...project.os },
  };
}

/** Returns problems with a permissions object (empty when valid). */
export function validatePermissions(perms: Permissions): string[] {
  const problems: string[] = [];
  const checkDecision = (where: string, value: unknown) => {
    if (!DECISIONS.includes(value as Decision)) problems.push(`${where}: "${String(value)}" is not allow/ask/deny`);
  };
  if (perms.default !== undefined) checkDecision("default", perms.default);
  const checkRules = (where: string, rules?: Rules) => {
    for (const key of Object.keys(rules ?? {})) {
      if (key.startsWith("$")) continue;
      if (!DECISIONS.includes(key as Decision)) problems.push(`${where}: unknown key "${key}"`);
      else if (!Array.isArray(rules?.[key as Decision])) problems.push(`${where}.${key}: must be a list`);
    }
  };
  checkRules("files.read", perms.files?.read);
  checkRules("files.edit", perms.files?.edit);
  checkRules("commands", perms.commands);
  for (const [name, actions] of Object.entries(perms.connections ?? {})) {
    for (const [action, value] of Object.entries(actions)) checkDecision(`connections.${name}.${action}`, value);
  }
  for (const [action, value] of Object.entries(perms.os ?? {})) checkDecision(`os.${action}`, value);
  return problems;
}

/** Converts a Nexo command pattern ("git push*", "docker *") into a Claude Code Bash rule. */
export function claudeBashRule(pattern: string): string {
  if (!pattern.endsWith("*")) return `Bash(${pattern})`;
  const prefix = pattern.slice(0, -1).trimEnd();
  return `Bash(${prefix}:*)`;
}

/** Converts a path glob relative to the environment root into an absolute Claude Code rule. */
function claudePathRule(tool: "Read" | "Edit", root: string, glob: string): string {
  const abs = join(root, glob).replace(/^\/+/, "");
  return `${tool}(//${abs})`;
}

/** Translates Nexo permissions into Claude Code's settings.json `permissions` block. */
export function toClaudePermissions(perms: Permissions, root: string): Record<Decision, string[]> {
  const out: Record<Decision, string[]> = { allow: [], ask: [], deny: [] };
  for (const decision of DECISIONS) {
    for (const glob of perms.files?.read?.[decision] ?? []) out[decision].push(claudePathRule("Read", root, glob));
    for (const glob of perms.files?.edit?.[decision] ?? []) out[decision].push(claudePathRule("Edit", root, glob));
    for (const pattern of perms.commands?.[decision] ?? []) out[decision].push(claudeBashRule(pattern));
  }
  for (const decision of DECISIONS) out[decision] = [...new Set(out[decision])];
  return out;
}
