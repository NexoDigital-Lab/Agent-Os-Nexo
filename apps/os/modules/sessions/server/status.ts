// Per-tab agent status, derived from what the SDK stream tells us (see agent.ts), plus the work status the agent
// sets itself through the in-process "work" MCP server.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Ev } from "./sdkEvents.ts";

export type AgentStatus = "idle" | "working" | "needs_you" | "done" | "error";
export type TurnEnd = "ok" | "error" | null; // how the last turn ended; null: none yet or stopped by the user

export type StatusInput = {
  running: boolean;
  waiting: number; // permission prompts + module events (e.g. SSH plans) waiting for the user
  end: TurnEnd;
  unseen: boolean; // the turn ended and the user has not opened the tab since
};

export function deriveStatus({ running, waiting, end, unseen }: StatusInput): AgentStatus {
  if (running) return waiting > 0 ? "needs_you" : "working";
  if (waiting > 0) return "needs_you";
  if (end && unseen) return end === "error" ? "error" : "done";
  return "idle";
}

/** Keeps the set of ids waiting for the user in step with the event stream. Returns true when the set changed. */
export function trackWaiting(waiting: Set<string>, ev: Ev): boolean {
  if (ev.kind === "perm") return !waiting.has(ev.id) && !!waiting.add(ev.id);
  if (ev.kind === "perm_done") return waiting.delete(ev.id);
  if (ev.kind === "module" && ev.waiting !== undefined) return ev.waiting ? !waiting.has(ev.id) && !!waiting.add(ev.id) : waiting.delete(ev.id);
  return false;
}

// ---- work status (set by the agent) ----

export const WORK_STATUSES = ["todo", "doing", "review", "done", "blocked"] as const;
export type WorkStatusValue = (typeof WORK_STATUSES)[number];
export type WorkStatus = { status: WorkStatusValue; note: string; at: number };
export const MAX_NOTE = 120;

/** Validates what the model sent; null when the status is not one of the known values. */
export function parseWorkStatus(status: unknown, note: unknown, now = Date.now()): WorkStatus | null {
  if (!WORK_STATUSES.includes(status as WorkStatusValue)) return null;
  const n = typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE) : "";
  return { status: status as WorkStatusValue, note: n, at: now };
}

export const WORK_NOTE =
  "agent-os-nexo shows your progress on the tab: call the set_work_status tool (mcp__work__set_work_status) when you start a task (\"doing\"), when it needs the user's review (\"review\"), when you finish (\"done\") or when you get blocked (\"blocked\"), with a short note (max 120 chars) in the user's language.";

export const WORK_TOOL_PREFIX = "mcp__work__";

export function createWorkServer(onSet: (w: WorkStatus) => void) {
  return createSdkMcpServer({
    name: "work",
    version: "1.0.0",
    tools: [
      tool(
        "set_work_status",
        "Updates the work status the user sees on the agent-os-nexo tab. Call it when you start, when the work needs review, when you finish or when you are blocked.",
        {
          status: z.enum(WORK_STATUSES),
          note: z.string().max(MAX_NOTE).optional().describe("One line (max 120 characters): what you are doing or what is missing"),
        },
        async ({ status, note }) => {
          const w = parseWorkStatus(status, note);
          if (!w) return { content: [{ type: "text" as const, text: "Invalid status" }], isError: true };
          onSet(w);
          return { content: [{ type: "text" as const, text: `Status: ${w.status}` }] };
        },
      ),
    ],
  });
}
