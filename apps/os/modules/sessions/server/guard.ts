// What an agent may never reach in agent-os itself, whatever its permission mode (a PreToolUse hook for every
// session): agent-os's own API (it would let an agent start other agents, change permissions or open terminals
// outside its own tools) and agent-os's private data (os/data: http tokens, notes, the ssh vault; .state/os:
// temporary keys, logs). Like the ssh guard it reads what the tool call says, so it stops the direct path, not a
// determined obfuscation; the real boundary is what the user lets an agent run (library/permissions.json).
import path from "node:path";
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";

export interface GuardScope {
  /** agent-os ports: the running one plus the defaults (app, preview, desktop). */
  ports: number[];
  /** Absolute folders: <env>/os/data and <env>/.state/os. */
  dirs: string[];
}

export const API_REASON = "agent-os's own API is only for its interface, not for agents (use your tools, or ask the user).";
export const DATA_REASON = "agent-os's private data (os/data, .state/os) is not accessible to agents.";

const LOOPBACK = String.raw`(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|::1)`;

/** Quotes and escapes out, ~/$HOME expanded, // and /./ and x/../ collapsed: the path as the shell would see it. */
export function flatten(s: string, home = process.env.HOME ?? ""): string {
  let t = s.replace(/['"\\]/g, "").replace(/(^|[\s=:(])(?:~|\$HOME|\$\{HOME\})(?=\/|\s|$)/g, (_, pre) => pre + home);
  t = t.replace(/\/{2,}/g, "/");
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/\/\.(?=\/|\s|$)/g, "").replace(/\/(?!\.\.(?:\/|\s|$))[^/\s]+\/\.\.(?=\/|\s|$)/g, "");
  }
  return t;
}

export function reachesApi(text: string, ports: number[]): boolean {
  const flat = flatten(text).replace(/%3a/gi, ":");
  return ports.some((p) => new RegExp(`${LOOPBACK}:${p}(?!\\d)`, "i").test(flat));
}

const inside = (abs: string, dirs: string[]) => dirs.some((d) => abs === d || abs.startsWith(d + path.sep));

/** A word or path that lands in the private folders once resolved against the agent's working folder. */
export function reachesData(text: string, dirs: string[], cwd: string): boolean {
  const roots = dirs.map((d) => path.resolve(d));
  for (const word of flatten(text).split(/[\s;|&<>()`=,]+/)) {
    if (!word || !/[/.]/.test(word)) continue;
    if (inside(path.resolve(cwd, word), roots)) return true;
  }
  return false;
}

const PATH_FIELDS = ["file_path", "path", "notebook_path"];

/** Why this tool call is refused, or null. `cwd` is where the agent runs (relative paths resolve from it). */
export function guardReason(tool: string, input: Record<string, unknown>, scope: GuardScope, cwd: string): string | null {
  const text = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  if (tool === "Bash" || tool === "WebFetch" || tool.startsWith("mcp__")) {
    const all = Object.values(input).filter((v): v is string => typeof v === "string");
    if (all.some((v) => reachesApi(v, scope.ports))) return API_REASON;
  }
  if (tool === "Bash" && reachesData(text("command"), scope.dirs, cwd)) return DATA_REASON;
  if (PATH_FIELDS.some((k) => text(k) && reachesData(text(k), scope.dirs, cwd))) return DATA_REASON;
  return null;
}

export function osGuard(scope: GuardScope): HookCallbackMatcher {
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = guardReason(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, scope, input.cwd);
    return reason ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } } : {};
  };
  return { hooks: [hook] };
}
