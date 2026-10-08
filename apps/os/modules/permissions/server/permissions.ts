// Permissions in agent-os: read and changed through the nexo CLI (`nexo permissions`), so the validation, the
// atomic write and the regeneration of every AI's files are the CLI's — the same as when the user runs it.
// Only the user's own page reaches this (the run's token); agents never hold it.
import type { Env } from "../../../host/server/env.ts";
import { httpError } from "../../../host/server/http.ts";
import { nexo } from "../../projects/server/lifecycle.ts";
import { projectIds } from "../../projects/server/projects.ts";

export type Decision = "allow" | "ask" | "deny";
export type Rules = Partial<Record<Decision, string[]>>;
export interface Permissions {
  default?: Decision;
  files?: { read?: Rules; edit?: Rules };
  commands?: Rules;
  connections?: Record<string, Partial<Record<"read" | "write" | "delete", Decision>>>;
  os?: Partial<Record<"build" | "restart" | "vault", Decision>>;
}

export interface PermissionsView {
  /** null: the global file (library/permissions.json). */
  project: string | null;
  /** What applies: global, or global + the project's overrides. */
  effective: Permissions;
  /** The global file, and the project's own file when a project is chosen. */
  global: Permissions;
  own: Permissions | null;
  projects: string[];
}

export const AREAS = ["files.read", "files.edit", "commands"] as const;
const DECISIONS = ["allow", "ask", "deny"];
const SETTING = /^(default|os\.(build|restart|vault)|connections\.[\w*.-]+\.(read|write|delete))$/;

/** The CLI runner; tests swap it. */
export const deps = { nexo };

function cliError(e: unknown): Error {
  const raw = (e as Error).message.replace(/^nexo permissions failed:\s*(nexo:\s*)?/, "").trim();
  if (/Unknown command "permissions"/.test(raw)) return httpError(501, "Your nexo CLI cannot edit permissions yet: update it (npm install -g @nexodigital/nexo).");
  if (/^Usage|Unknown setting|Not saved|cannot be empty|at most|one line|has no rule|Invalid project/.test(raw)) return httpError(400, raw);
  if (/No project/.test(raw)) return httpError(404, raw);
  return e as Error;
}

/** `nexo permissions <action> [options] -- <values>`: values after `--`, so a pattern like "-rf*" stays a value. */
const cli = (env: Env, action: string, values: string[], project: string | null, options: string[] = []) =>
  deps
    .nexo(env, ["permissions", action, ...options, ...(project ? ["--project", project] : []), "--", ...values])
    .catch((e: unknown) => Promise.reject(cliError(e)));

/** A known project id, or null for the global file. */
export function scopeOf(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const id = String(raw);
  if (!projectIds().includes(id)) throw httpError(404, `Unknown project: ${id}`);
  return id;
}

export async function view(env: Env, project: string | null): Promise<PermissionsView> {
  const out = JSON.parse(await cli(env, "show", [], project, ["--json"])) as { effective: Permissions; global?: Permissions; project?: Permissions };
  return { project, effective: out.effective, global: out.global ?? out.effective, own: project ? out.project ?? {} : null, projects: projectIds() };
}

/** Puts a pattern under a decision, or (decision null) removes it. */
export async function setRule(env: Env, project: string | null, body: unknown): Promise<PermissionsView> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!AREAS.includes(b.area as (typeof AREAS)[number])) throw httpError(400, `area must be one of ${AREAS.join(", ")}`);
  if (b.decision !== null && !DECISIONS.includes(b.decision as string)) throw httpError(400, "decision must be allow, ask, deny or null (remove)");
  if (typeof b.pattern !== "string" || !b.pattern.trim() || b.pattern.length > 200 || /[\r\n]/.test(b.pattern)) {
    throw httpError(400, "pattern must be one line of 1–200 characters");
  }
  await cli(env, b.decision === null ? "remove" : String(b.decision), [String(b.area), b.pattern.trim()], project);
  return view(env, project);
}

/** Sets `default`, `os.<action>` or `connections.<name>.<action>`. */
export async function setSetting(env: Env, project: string | null, body: unknown): Promise<PermissionsView> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.key !== "string" || !SETTING.test(b.key)) throw httpError(400, "key must be default, os.<build|restart|vault> or connections.<name>.<read|write|delete>");
  if (!DECISIONS.includes(b.decision as string)) throw httpError(400, "decision must be allow, ask or deny");
  await cli(env, "set", [b.key, String(b.decision)], project);
  return view(env, project);
}
