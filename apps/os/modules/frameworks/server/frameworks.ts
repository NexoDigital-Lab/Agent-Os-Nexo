// Frameworks in agent-os-nexo: listed and changed only through the nexo CLI (`nexo framework …`), so the install rules
// (exact npm versions, no install scripts, `path:` never modified), the validation and the regeneration of every AI's
// files are the CLI's — the same as in a terminal. Only the user's own page reaches this (the run's token).
import type { Env } from "../../../host/server/env.ts";
import { bumpFrameworks, FRAMEWORK_NAME, NEXO_METHOD, parseFrameworksList, type FrameworksList } from "../../../host/server/frameworks.ts";
import { httpError } from "../../../host/server/http.ts";
import { nexo } from "../../projects/server/lifecycle.ts";

/** The CLI runner; tests swap it. */
export const deps = { nexo };

const NPM = /^npm:(@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function cliError(e: unknown): Error {
  const raw = (e as Error).message.replace(/^nexo framework failed:\s*(nexo:\s*)?/, "").trim();
  if (/Unknown command "framework"/.test(raw)) return httpError(501, "Your nexo CLI cannot manage frameworks yet: update it (npm install -g @nexodigital/nexo).");
  if (/^No framework/.test(raw)) return httpError(404, raw);
  if (/already exists/.test(raw)) return httpError(409, raw);
  if (/^Usage|Enable ".*" first|is a tool|is not enabled|Invalid framework name|exact version|not a valid npm|Unknown source|not a folder|did not produce/.test(raw)) return httpError(400, raw);
  return e as Error;
}

/** `nexo framework <action> [options] -- <values>`: the values after `--`, so no value can be taken for an option. */
const cli = (env: Env, action: string, values: string[] = [], options: string[] = []) =>
  deps.nexo(env, ["framework", action, ...options, "--", ...values]).catch((e: unknown) => Promise.reject(cliError(e)));

export async function list(env: Env): Promise<FrameworksList> {
  return parseFrameworksList(await cli(env, "list", [], ["--json"]));
}

/** A framework folder name from the URL or body. */
export function nameOf(raw: unknown): string {
  if (typeof raw !== "string" || !FRAMEWORK_NAME.test(raw)) throw httpError(400, "Invalid framework name");
  return raw;
}

const flag = (v: unknown, field: string): boolean => {
  if (typeof v !== "boolean") throw httpError(400, `${field} must be true or false`);
  return v;
};

async function changed(env: Env): Promise<FrameworksList> {
  bumpFrameworks();
  return list(env);
}

/** Makes a framework available (or not) to pick in a tab; a tool is simply switched on or off. */
export async function setEnabled(env: Env, name: string, body: unknown): Promise<FrameworksList> {
  const on = flag((body as Record<string, unknown> | undefined)?.enabled, "enabled");
  await cli(env, on ? "enable" : "disable", [name]);
  return changed(env);
}

/** The environment default: a method that is enabled, or "nexo" (Nexo's own method, no framework). */
export async function setDefault(env: Env, body: unknown): Promise<FrameworksList> {
  const name = (body as Record<string, unknown> | undefined)?.name;
  await cli(env, "default", [name === NEXO_METHOD ? NEXO_METHOD : nameOf(name)]);
  return changed(env);
}

/**
 * Approves or withdraws the hooks. Approving needs `seen`: the exact commands the user was shown. If the framework
 * changed since (a different list), nothing is approved and the user looks again.
 */
export async function setHooks(env: Env, name: string, body: unknown): Promise<FrameworksList> {
  const b = (body ?? {}) as Record<string, unknown>;
  const approved = flag(b.approved, "approved");
  if (approved) {
    const seen = Array.isArray(b.seen) && b.seen.every((x) => typeof x === "string") ? (b.seen as string[]) : null;
    if (!seen) throw httpError(400, "seen must list the hook commands the user was shown");
    const fw = (await list(env)).frameworks.find((f) => f.name === name);
    if (!fw) throw httpError(404, `No framework "${name}".`);
    if (JSON.stringify(fw.hookCommands) !== JSON.stringify(seen)) throw httpError(409, "Its hooks changed since you looked: review them again.");
    if (!fw.hookCommands.length) throw httpError(400, "That framework has no hooks to approve.");
  }
  await cli(env, approved ? "enable" : "disable", [name], ["--hooks"]);
  return changed(env);
}

/** `npm:<pkg>@<exact version>` or `path:<absolute folder>`: the only sources the CLI takes. */
export function sourceOf(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 500 || /[\r\n\0]/.test(raw)) throw httpError(400, "source must be one line: npm:<pkg>@<exact version> or path:<folder>");
  const s = raw.trim();
  if (s.startsWith("npm:")) {
    if (!NPM.test(s)) throw httpError(400, "An npm source needs an exact version: npm:<pkg>@1.2.3 (ranges and latest are refused)");
    return s;
  }
  if (s.startsWith("path:") && /^path:(\/|[A-Za-z]:[\\/]|~[\\/])/.test(s)) return s;
  throw httpError(400, "source must be npm:<pkg>@<exact version> or path:<absolute folder>");
}

export async function add(env: Env, body: unknown): Promise<FrameworksList> {
  const b = (body ?? {}) as Record<string, unknown>;
  const source = sourceOf(b.source);
  const name = b.name === undefined || b.name === null || b.name === "" ? null : nameOf(b.name);
  // Added off: nothing is active until the user enables it.
  await cli(env, "add", [source], name ? ["--name", name] : []);
  return changed(env);
}

export async function remove(env: Env, name: string): Promise<FrameworksList> {
  await cli(env, "remove", [name]);
  return changed(env);
}
