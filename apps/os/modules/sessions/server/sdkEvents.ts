// The SDK's message stream flattened into the events the web UI renders.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type Ev =
  | { kind: "user"; text: string; skills: string[]; images: string[]; quick?: string }
  | {
      kind: "task";
      id: string;
      toolUseId?: string;
      type: string;
      description: string;
      status: "running" | "completed" | "failed" | "stopped" | "killed" | "paused" | "pending";
      tokens?: number;
      tools?: number;
      ms?: number;
      lastTool?: string;
      now?: string; // what it is doing right now (progress text)
      summary?: string;
    }
  | { kind: "activity"; tool: string | null }
  | { kind: "init"; model: string; skills: string[]; mode: string }
  | { kind: "text"; text: string; sub: boolean }
  | { kind: "tool"; id: string; name: string; input: unknown; sub: boolean }
  | { kind: "tool_result"; id: string; text: string; isError: boolean }
  | { kind: "perm"; id: string; tool: string; input: unknown; always?: { rules: string[]; where: string } }
  | { kind: "perm_done"; id: string; allow: boolean }
  | { kind: "result"; cost: number; turns: number; ms: number; ok: boolean; text: string }
  | { kind: "error"; text: string }
  | { kind: "note"; text: string }
  | { kind: "status"; running: boolean }
  | { kind: "replay_done" } // stream-only marker after a (re)connect replay; never stored
  // An event another module adds to the tab's stream (e.g. ssh's command plans); its web side renders it through
  // the "chat.events" slot. `waiting: true` counts it as waiting for the user until an event with the same id says false.
  | { kind: "module"; module: string; type: string; id: string; waiting?: boolean; data: unknown };

/** What `translate` reads and updates on a session. */
type EventTarget = { events: Ev[]; sdkSessionId?: string; cost: number };

const clip = (t: string, n = 4000) => (t.length > n ? t.slice(0, n) + `\n… (+${t.length - n} chars)` : t);

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((b) => (b?.type === "text" ? b.text : b?.type ? `[${b.type}]` : "")).join("\n");
  return "";
}

export function lastTask(s: { events: Ev[] }, taskId: string) {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e?.kind === "task" && e.id === taskId) return e;
  }
  return null;
}

/** Folds one SDK message into UI events (and the session id / cost it reports). */
export function translate(s: EventTarget, msg: SDKMessage, emit: (ev: Ev) => void) {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        s.sdkSessionId = msg.session_id;
        emit({ kind: "init", model: msg.model, skills: msg.skills, mode: msg.permissionMode });
      } else if (msg.subtype === "task_started") {
        emit({
          kind: "task", id: msg.task_id, toolUseId: msg.tool_use_id, type: msg.subagent_type ?? msg.task_type ?? "task",
          description: msg.description, status: "running",
        });
      } else if (msg.subtype === "task_progress") {
        const prev = lastTask(s, msg.task_id);
        emit({
          kind: "task", id: msg.task_id, toolUseId: msg.tool_use_id ?? prev?.toolUseId, type: msg.subagent_type ?? prev?.type ?? "task",
          description: prev?.description ?? msg.description, now: msg.summary ?? msg.description,
          status: "running", tokens: msg.usage.total_tokens, tools: msg.usage.tool_uses, ms: msg.usage.duration_ms,
          lastTool: msg.last_tool_name,
        });
      } else if (msg.subtype === "task_updated" && msg.patch.status) {
        const prev = lastTask(s, msg.task_id);
        if (prev) emit({ ...prev, status: msg.patch.status });
      } else if (msg.subtype === "task_notification") {
        const prev = lastTask(s, msg.task_id);
        emit({
          ...(prev ?? { kind: "task", id: msg.task_id, type: "task", description: "" }),
          kind: "task", toolUseId: msg.tool_use_id ?? prev?.toolUseId, status: msg.status, summary: msg.summary,
          tokens: msg.usage?.total_tokens ?? prev?.tokens, tools: msg.usage?.tool_uses ?? prev?.tools, ms: msg.usage?.duration_ms ?? prev?.ms,
        });
      }
      break;
    case "assistant": {
      const sub = msg.parent_tool_use_id !== null;
      for (const b of msg.message.content) {
        if (b.type === "text" && b.text.trim()) emit({ kind: "text", text: b.text, sub });
        if (b.type === "tool_use") {
          emit({ kind: "tool", id: b.id, name: b.name, input: b.input, sub });
          if (!sub) emit({ kind: "activity", tool: b.name });
        }
      }
      break;
    }
    case "user": {
      const content = msg.message.content;
      if (!Array.isArray(content)) break;
      for (const b of content) {
        if (b.type === "tool_result")
          emit({ kind: "tool_result", id: b.tool_use_id, text: clip(resultText(b.content)), isError: !!b.is_error });
      }
      break;
    }
    case "result":
      s.sdkSessionId = msg.session_id;
      s.cost = msg.total_cost_usd;
      emit({
        kind: "result",
        cost: msg.total_cost_usd,
        turns: msg.num_turns,
        ms: msg.duration_ms,
        ok: msg.subtype === "success" && !msg.is_error,
        text: msg.subtype === "success" ? msg.result : msg.subtype,
      });
      break;
  }
}
