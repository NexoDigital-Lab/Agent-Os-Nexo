// One-shot, read-only Claude queries other modules use (practice, architecture, notes, extensions, skill
// recommendations): no session is saved, the model can only look at the code (Read/Glob/Grep), never change it.
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { httpError } from "../../../host/server/http.ts";

export const READ_ONLY = ["Read", "Glob", "Grep"];
export const MODEL = "sonnet";

/** The SDK's query function; the callers below take it as a parameter so tests can pass a fake stream. */
export type QueryFn = typeof query;

// Real path when it exists, else the real path of the nearest existing ancestor + the rest (so a symlink can't smuggle a path out).
function realOrAncestor(abs: string): string {
  let cur = abs;
  const rest: string[] = [];
  while (!existsSync(cur) && path.dirname(cur) !== cur) {
    rest.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  try {
    return path.join(realpathSync(cur), ...rest);
  } catch {
    return abs;
  }
}

const within = (root: string, p: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** Does this path (relative to cwd, or ~-prefixed) land inside cwd or one of the extra dirs? */
export function pathAllowed(p: string, cwd: string, extraDirs: string[] = []): boolean {
  if (p.includes("\0")) return false;
  const expanded = p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
  const abs = realOrAncestor(path.resolve(cwd, expanded)); // resolve() already collapses '..'
  return [cwd, ...extraDirs].some((d) => within(realOrAncestor(path.resolve(d)), abs));
}

/** Paths a Read/Glob/Grep call touches: file_path/path, plus the glob (Glob's pattern, Grep's glob). A glob is checked
 *  by its literal prefix, and any '..' segment in it is refused outright. */
export function toolPaths(tool: string, input: Record<string, unknown>): { paths: string[]; bad: boolean } {
  const paths: string[] = [];
  let bad = false;
  for (const k of ["file_path", "path"]) if (typeof input[k] === "string" && input[k]) paths.push(input[k] as string);
  const glob = tool === "Glob" ? input.pattern : tool === "Grep" ? input.glob : undefined;
  if (typeof glob === "string" && glob) {
    if (glob.split(/[\\/]/).includes("..")) bad = true;
    if (glob.startsWith("/") || glob.startsWith("~")) paths.push(glob.split(/[*?[{]/)[0] || "/");
  }
  return { paths, bad };
}

/** PreToolUse hook: the model may only read inside the cwd (+ extra dirs) — not ~/.ssh, secrets, other projects. */
export const confineHook = (cwd: string, extraDirs: string[] = []): HookCallbackMatcher => ({
  matcher: "Read|Glob|Grep",
  hooks: [
    async (input) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const { paths, bad } = toolPaths(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
      if (!bad && paths.every((p) => pathAllowed(p, cwd, extraDirs))) return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: "Access denied: you may only read files inside the project.",
        },
      };
    },
  ],
});

const baseOptions = (cwd: string, extraDirs: string[] = []) => ({
  cwd,
  model: MODEL,
  tools: READ_ONLY,
  allowedTools: READ_ONLY,
  additionalDirectories: extraDirs,
  settingSources: [] as [],
  persistSession: false,
  maxTurns: 30,
  hooks: { PreToolUse: [confineHook(cwd, extraDirs)] },
});

/** Runs the prompt and returns the model's output validated by `schema` (json_schema output format). */
export async function structured<T>(prompt: string, cwd: string, schema: Record<string, unknown>, extraDirs: string[] = [], run: QueryFn = query) {
  let out: T | null = null;
  let cost = 0;
  let error = "";
  for await (const msg of run({ prompt, options: { ...baseOptions(cwd, extraDirs), outputFormat: { type: "json_schema", schema } } })) {
    if (msg.type === "result") {
      cost = msg.total_cost_usd;
      if (msg.subtype === "success") out = msg.structured_output as T;
      else error = msg.subtype;
    }
  }
  if (!out) throw httpError(502, `Claude returned no result (${error || "no output"})`);
  return { out, cost };
}

/** Same read-only query, but free text: `system` is the whole system prompt (no Claude Code preset). */
export async function ask(prompt: string, system: string, cwd: string, run: QueryFn = query) {
  let text = "";
  let cost = 0;
  let error = "";
  for await (const msg of run({ prompt, options: { ...baseOptions(cwd), systemPrompt: system, maxTurns: 20 } })) {
    if (msg.type === "result") {
      cost = msg.total_cost_usd;
      if (msg.subtype === "success") text = msg.result;
      else error = msg.subtype;
    }
  }
  if (!text.trim()) throw httpError(502, `Claude did not answer (${error || "no output"})`);
  return { text: text.trim(), cost };
}
