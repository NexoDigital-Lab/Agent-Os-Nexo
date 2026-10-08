// The user's dictionary (library/dictionary/), read and written through the nexo CLI (`nexo dict`), so the file
// format and library/index.json — where agents see every term — are the same whether a term is saved here, by an
// agent, or in a terminal.
import type { Env } from "../../../host/server/env.ts";
import { httpError } from "../../../host/server/http.ts";
import { nexo } from "../../projects/server/lifecycle.ts";

export interface Term {
  term: string;
  aliases: string[];
  summary: string;
  owner: string;
  updated: string;
  path: string;
  body?: string;
}

export interface TermInput {
  term: string;
  summary?: string;
  aliases?: string[];
  body?: string;
}

/** The CLI runner; tests swap it. */
export const deps = { nexo };

const MAX_TERM = 80;
const MAX_SUMMARY = 240;
const MAX_BODY = 20_000;

/** The CLI's own message without the "nexo dict failed: nexo:" wrapper, with the right status. */
function cliError(e: unknown): Error {
  const raw = (e as Error).message.replace(/^nexo dict failed:\s*(nexo:\s*)?/, "").trim();
  if (/Unknown command "dict"/.test(raw)) return httpError(501, "Your nexo CLI has no dictionary yet: update it (npm install -g @nexodigital/nexo).");
  if (/^No term/.test(raw)) return httpError(404, raw);
  if (/already the term/.test(raw)) return httpError(409, raw);
  if (/give it a summary|at most|letter or digit|Usage/.test(raw)) return httpError(400, raw);
  return e as Error;
}

const dict = (env: Env, args: string[]) => deps.nexo(env, ["dict", ...args]).catch((e: unknown) => Promise.reject(cliError(e)));

function text(v: unknown, field: string, max: number, required = false): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) throw httpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw httpError(400, `${field} must be text`);
  if (v.length > max) throw httpError(400, `${field} is at most ${max} characters`);
  return v;
}

/** Validated input from a request body. */
export function parseInput(body: unknown): TermInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const term = text(b.term, "term", MAX_TERM, true)?.trim() ?? "";
  if (!/[\p{L}\p{N}]/u.test(term)) throw httpError(400, "term needs at least one letter or digit");
  const aliases = b.aliases === undefined ? undefined : b.aliases;
  if (aliases !== undefined && (!Array.isArray(aliases) || aliases.length > 20 || aliases.some((a) => typeof a !== "string" || a.length > MAX_TERM))) {
    throw httpError(400, "aliases must be a list of up to 20 short texts");
  }
  return {
    term,
    summary: text(b.summary, "summary", MAX_SUMMARY),
    aliases: aliases as string[] | undefined,
    body: b.body === undefined ? undefined : text(b.body, "body", MAX_BODY) ?? "",
  };
}

export async function listTerms(env: Env): Promise<Term[]> {
  return JSON.parse(await dict(env, ["list", "--json"]) || "[]") as Term[];
}

export async function showTerm(env: Env, name: string): Promise<Term> {
  return JSON.parse(await dict(env, ["show", "--json", "--", name])) as Term;
}

/** Creates or updates a term; `from` renames that term to `input.term`. Options go before `--`, the term after it. */
export async function saveTerm(env: Env, input: TermInput, from?: string): Promise<Term> {
  const opts = [
    ...(input.summary !== undefined ? ["--summary", input.summary] : []),
    ...(input.aliases !== undefined ? ["--alias", input.aliases.map((a) => a.replace(/,/g, " ")).join(",")] : []),
    ...(input.body !== undefined ? ["--body", input.body] : []),
    ...(from !== undefined ? ["--from", from] : []),
  ];
  await dict(env, ["add", ...opts, "--", input.term]);
  return showTerm(env, input.term); // by the new name, or by the alias it was saved under
}

export async function removeTerm(env: Env, name: string): Promise<void> {
  await dict(env, ["rm", "--", name]);
}
