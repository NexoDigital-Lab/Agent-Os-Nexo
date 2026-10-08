// Editing permissions.json without hand-written JSON: one rule or one decision at a time, validated, written
// atomically. `nexo permissions` and agent-os use it, so every change goes through the same checks.
import { existsSync, renameSync } from "node:fs";
import { DECISIONS, loadPermissions, validatePermissions, type Decision, type Permissions, type Rules } from "./permissions.ts";
import { writeJson } from "./fsx.ts";

/** The pattern lists: which files may be read or edited, which commands run. */
export const RULE_AREAS = ["files.read", "files.edit", "commands"] as const;
export type RuleArea = (typeof RULE_AREAS)[number];

/** Single decisions: the default, agent-os actions, and connections (`connections.<name>.<read|write|delete>`). */
const OS_ACTIONS = ["build", "restart", "vault"];
const CONNECTION_ACTIONS = ["read", "write", "delete"];
const MAX_PATTERN = 200;

export const isDecision = (v: unknown): v is Decision => DECISIONS.includes(v as Decision);
export const isRuleArea = (v: unknown): v is RuleArea => RULE_AREAS.includes(v as RuleArea);

function rulesOf(perms: Permissions, area: RuleArea): Rules {
  if (area === "commands") return (perms.commands ??= {});
  perms.files ??= {};
  return area === "files.read" ? (perms.files.read ??= {}) : (perms.files.edit ??= {});
}

function checkPattern(pattern: string): string {
  const p = pattern.trim();
  if (!p) throw new Error("A pattern cannot be empty.");
  if (p.length > MAX_PATTERN) throw new Error(`A pattern is at most ${MAX_PATTERN} characters.`);
  if (/[\r\n]/.test(p)) throw new Error("A pattern is one line.");
  return p;
}

/** Puts `pattern` under `decision` in `area`, taking it out of the other two decisions there. */
export function setRule(perms: Permissions, area: RuleArea, decision: Decision, pattern: string): Permissions {
  const p = checkPattern(pattern);
  const rules = rulesOf(perms, area);
  for (const d of DECISIONS) {
    const list = (rules[d] ?? []).filter((x) => x !== p);
    if (d === decision) list.push(p);
    if (list.length) rules[d] = list;
    else delete rules[d];
  }
  return perms;
}

/** Removes `pattern` from every decision of `area`; false when it was not there. */
export function removeRule(perms: Permissions, area: RuleArea, pattern: string): boolean {
  const p = pattern.trim();
  const rules = rulesOf(perms, area);
  let found = false;
  for (const d of DECISIONS) {
    const list = rules[d];
    if (!list?.includes(p)) continue;
    found = true;
    const rest = list.filter((x) => x !== p);
    if (rest.length) rules[d] = rest;
    else delete rules[d];
  }
  return found;
}

/** Sets a single decision: `default`, `os.<build|restart|vault>` or `connections.<name>.<read|write|delete>`. */
export function setDecision(perms: Permissions, key: string, decision: Decision): Permissions {
  const parts = key.split(".");
  if (key === "default") perms.default = decision;
  else if (parts[0] === "os" && parts.length === 2 && OS_ACTIONS.includes(parts[1] ?? "")) {
    (perms.os ??= {})[parts[1] as "build" | "restart" | "vault"] = decision;
  } else if (parts[0] === "connections" && parts.length === 3 && /^[\w*-]+$/.test(parts[1] ?? "") && CONNECTION_ACTIONS.includes(parts[2] ?? "")) {
    ((perms.connections ??= {})[parts[1] as string] ??= {})[parts[2] as "read" | "write" | "delete"] = decision;
  } else {
    throw new Error(`Unknown setting "${key}". Use default, os.${OS_ACTIONS.join("|os.")}, or connections.<name>.<${CONNECTION_ACTIONS.join("|")}>.`);
  }
  return perms;
}

/** Loads `file`, applies `change`, validates, and writes it atomically (a temp file renamed over it). */
export function editPermissions(file: string, change: (perms: Permissions) => void): Permissions {
  const perms = existsSync(file) ? loadPermissions(file) : {};
  change(perms);
  const problems = validatePermissions(perms);
  if (problems.length) throw new Error(`Not saved — ${problems.join("; ")}`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeJson(tmp, perms);
  renameSync(tmp, file);
  return perms;
}
