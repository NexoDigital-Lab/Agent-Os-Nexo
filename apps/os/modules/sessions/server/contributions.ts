// How other modules take part in a tab's AI session without sessions importing them: ssh adds its console
// tools and barriers, docker/devenv its environment, architecture its plan, monitor reads rate limits, home logs
// each turn. Each registers once at startup with contributeToSessions().
import type { HookCallbackMatcher, HookEvent, McpServerConfig, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Ev } from "./sdkEvents.ts";

/** What a contribution sees of a tab. */
export interface TabContext {
  id: string;
  title: string;
  /** Project id ("shop", "crm-ws/api"), or "" for a tab with no project (e.g. an SSH console). */
  project: string;
  /** Where the agent runs: the project folder (AGENTS.md, .claude/, context/), or the home folder without a project. */
  dir: string;
  /** The repository the tab works on: code/ or a worktree. */
  cwd: string;
  /** worktrees/<name> when the tab works on a worktree. */
  worktree: string | null;
  /** Free-form per-module data that survives restarts ({ ssh: {...}, archOff: true }). */
  meta: Record<string, unknown>;
}

export interface TurnInfo {
  prompt: string;
  skills: string[];
  /** Total cost of the tab's session so far (USD). */
  cost: number;
  turns: number;
  ok: boolean;
}

export interface SessionContribution {
  /** Lines added to the system prompt of the tab's next turn. */
  promptNote?: (tab: TabContext) => string | null | undefined;
  /** Extra environment variables for the agent process. */
  env?: (tab: TabContext) => Record<string, string> | null | undefined;
  /** In-process MCP servers for this turn. `emit` adds an event to the tab's stream; `signal` aborts with the turn. */
  mcpServers?: (tab: TabContext, io: { emit: (ev: Ev) => void; signal: AbortSignal }) => Record<string, McpServerConfig> | null | undefined;
  /** Tools that never prompt the user here because they gate themselves. */
  autoAllow?: (tab: TabContext, tool: string) => boolean;
  /** Hooks for every agent-os session (merged with the others'). */
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Every SDK message of every turn. */
  onMessage?: (tab: TabContext, msg: SDKMessage) => void;
  /** After every turn, also failed or stopped ones. */
  onTurnEnd?: (tab: TabContext, info: TurnInfo) => void;
  /** The tab is closing. */
  onClose?: (tab: TabContext) => void;
}

const list: SessionContribution[] = [];

export function contributeToSessions(c: SessionContribution): void {
  list.push(c);
}

export const contributions = (): readonly SessionContribution[] => list;

/** Every contribution's hooks, merged per event. */
export function mergedHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const out: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  for (const c of list) for (const [event, matchers] of Object.entries(c.hooks ?? {})) (out[event as HookEvent] ??= []).push(...(matchers ?? []));
  return out;
}

/** Runs a contribution callback, keeping one broken module from taking the session down. */
export function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    console.error("[sessions] a module contribution failed:", e);
    return fallback;
  }
}
