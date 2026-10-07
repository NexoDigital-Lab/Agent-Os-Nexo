// What the agent can do with an SSH tab, as an in-process MCP server ("ssh"), plus the PreToolUse guard every agent-os-nexo
// query gets. The gating lives inside the tools: nothing here runs unless the user shares the console, and anything
// that is not read-only needs a plan the user approved (that approval, not the permission mode, is what counts).
import { createSdkMcpServer, tool, type HookCallback, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Ev } from "../../sessions/server/sdkEvents.ts";
import { blockedToolUse, explainReadOnly } from "./policy.ts";
import { assertConnected, assertRunnable, onSessionReset, readTail, runCommand, status } from "./session.ts";
import type { SshPlan, SshPlanStep } from "./types.ts";

const MAX_COMMAND = 3500; // a tty line holds 4095 bytes; the marker needs room too
export const APPROVAL_TTL_MS = 30 * 60_000; // an approved step nobody ran in this long needs a fresh approval
// Invisible or confusable characters (zero-width, bidi overrides, exotic spaces) can make a command read differently
// to the user than it executes.
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\u00a0\u1680\u2000-\u200b\u202a-\u202f\u205f\u2066-\u2069\u3000]/u;

type Plan = { tabId: string; settle: (approve: boolean) => void };
const plans = new Map<string, Plan>(); // pending only
type Step = { command: string; at: number };
const approved = new Map<string, Step[]>(); // tabId → steps of approved plans not yet run (each runs once, until TTL)

/** The user's decision on a pending plan (POST /api/ssh/plans/:id). False when it is unknown or already decided. */
export function decidePlan(id: string, approve: boolean): boolean {
  const p = plans.get(id);
  if (!p) return false;
  p.settle(approve);
  return true;
}

/** Closing a tab: reject its pending plans and forget the approvals. */
export function forgetTab(tabId: string) {
  for (const p of [...plans.values()]) if (p.tabId === tabId) p.settle(false);
  approved.delete(tabId);
}

/** Approvals do not outlive the turn (agent.ts), the sharing switch or the connection that they were given for. */
export const endTurn = (tabId: string) => void approved.delete(tabId);
onSessionReset(endTurn);

const text = (v: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const NOT_SHARED = "The SSH console is not shared: ask the user to turn on 'The agent sees the console'";

/** A plan as a module event in the tab's chat: pending ones wait for the user (the tab shows "needs you"). */
const planEvent = (id: string, plan: SshPlan): Ev => ({ kind: "module", module: "ssh", type: "plan", id, waiting: plan.status === "pending", data: plan });

/** A command typed into the console must be one clean line. */
function lineProblem(cmd: string): string | null {
  if (!cmd.trim()) return "The command is empty";
  if (INVISIBLE.test(cmd)) return "The command has invisible characters; write it in ASCII";
  if (/[\x00-\x1f\x7f]/.test(cmd)) return "The command has line breaks or control characters: use a single line (chain with ; or &&)";
  return cmd.length > MAX_COMMAND ? "The command is too long" : null;
}

/** Wraps a handler: unknown tab / not shared / thrown errors become tool errors the model can act on. */
const guarded =
  <A>(tabId: string, h: (a: A) => Promise<ReturnType<typeof text>>) =>
  async (args: A) => {
    const s = status(tabId);
    if (!s) return text("There is no SSH session in this tab", true);
    if (!s.shared) return text(NOT_SHARED, true);
    try {
      return await h(args);
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true);
    }
  };

/** The approved, unexpired step equal to `command`, removed from the list (single use); `undefined` when there is none. */
function takeStep(tabId: string, command: string): Step | undefined {
  const left = (approved.get(tabId) ?? []).filter((st) => Date.now() - st.at < APPROVAL_TTL_MS);
  approved.set(tabId, left);
  const i = left.findIndex((st) => st.command === command);
  return i < 0 ? undefined : left.splice(i, 1)[0];
}

/**
 * The tools' logic, separate from the MCP wiring so it can be tested with a fake console. `emit` puts an event in the
 * tab's chat; `signal` is the turn's abort signal (stop button or tab closed), which rejects a plan still waiting.
 */
export function sshHandlers(tabId: string, emit: (ev: Ev) => void, signal: AbortSignal) {
  return {
    status: guarded(tabId, async () => {
      const s = status(tabId)!;
      return text({ host: s.hostName, state: s.state, shared: s.shared, busy: s.busy });
    }),

    read: guarded(tabId, async ({ lines }: { lines?: number }) => {
      assertConnected(tabId); // a command still running is fine to read
      return text(readTail(tabId, lines ?? 120));
    }),

    run: guarded(tabId, async ({ command, timeoutSec }: { command: string; timeoutSec?: number }) => {
      const bad = lineProblem(command);
      if (bad) return text(bad, true);
      assertRunnable(tabId);
      const notReadOnly = explainReadOnly(command);
      let step: Step | undefined;
      if (notReadOnly !== null) {
        step = takeStep(tabId, command);
        if (!step) return text(`That command changes things: make a plan with ssh_plan and wait for the approval. (${notReadOnly})`, true);
      }
      let r;
      try {
        r = await runCommand(tabId, command, timeoutSec ?? 30);
      } catch (e) {
        if (step) approved.set(tabId, [...(approved.get(tabId) ?? []), step]); // never typed: the approval is intact
        throw e;
      }
      // A timeout interrupted the step before it could finish: it stays approved (single use) to be retried.
      if (step && r.status === "timeout") approved.set(tabId, [...(approved.get(tabId) ?? []), step]);
      const note =
        r.status === "waiting_password" ? "A password prompt is waiting. Ask the user to type it in the console (you don't see it) and then read with ssh_read."
        : r.status === "timeout" ? `Timed out: Ctrl+C was sent. ${step ? "The step is still approved (one more time): repeat it with a larger timeoutSec." : "If it needed longer, repeat it with a larger timeoutSec."}`
        : r.status === "closed" ? "The console closed or reconnected while the command ran: it is unknown whether it finished. Check with ssh_read when the user reconnects."
        : undefined;
      return text({ ...r, ...(note ? { note } : {}) });
    }),

    plan: guarded(tabId, async ({ summary, steps }: { summary: string; steps: SshPlanStep[] }) => {
      for (const s of steps) {
        const bad = lineProblem(s.command);
        if (bad) return text(`Step "${s.command.slice(0, 60)}": ${bad}`, true);
      }
      approved.delete(tabId); // a new plan replaces approvals that were never used
      const id = crypto.randomUUID();
      const ok = await new Promise<boolean>((resolve) => {
        const plan: Plan = {
          tabId,
          settle: (approve) => {
            plans.delete(id);
            signal.removeEventListener("abort", onAbort);
            emit(planEvent(id, { summary, steps, status: approve ? "approved" : "rejected" }));
            resolve(approve);
          },
        };
        const onAbort = () => plan.settle(false);
        plans.set(id, plan);
        emit(planEvent(id, { summary, steps, status: "pending" }));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      if (!ok) return text("The user rejected the plan (or it was cancelled). Do not run those commands; ask them how to continue.");
      const at = Date.now();
      approved.set(tabId, steps.map((s) => ({ command: s.command, at })));
      return text("Plan approved (valid for this turn, up to 30 minutes and while the console stays shared). Run each step with ssh_run, with the exact command, once each.");
    }),
  };
}

/** The "ssh" MCP server of one tab's query. */
export function createSshServer(tabId: string, emit: (ev: Ev) => void, signal: AbortSignal) {
  const ro = { annotations: { readOnlyHint: true } };
  const h = sshHandlers(tabId, emit, signal);
  return createSdkMcpServer({
    name: "ssh",
    version: "1.0.0",
    tools: [
      tool("ssh_status", "State of this tab's SSH console: host, connection, whether the user shares it and whether a command is running.", {}, h.status, ro),

      tool(
        "ssh_read",
        "Reads the last lines of the SSH console since the user shared it (no colors, secrets masked). Use it to see what the user did or the result of a command that was left waiting.",
        { lines: z.number().int().min(1).max(400).optional().describe("How many last lines (default 120)") },
        h.read,
        ro,
      ),

      tool(
        "ssh_run",
        "Runs a command in the SSH console (the user watches it run) and returns {exitCode, output, status}. Only READ commands (ls, cat, grep, ps, df, docker ps, git status, systemctl status…, with pipes) or an exact step of a plan already approved with ssh_plan. status 'waiting_password': there is a password prompt; ask the user to type it in the console and then use ssh_read. 'timeout': it was stopped with Ctrl+C. 'closed': the console closed during the command. Fails if the console is not at a shell prompt.",
        { command: z.string().describe("A single line"), timeoutSec: z.number().int().min(1).max(300).optional().describe("Default 30") },
        h.run,
      ),

      tool(
        "ssh_plan",
        "Proposes ONE plan of commands that are not read-only and waits for the user to approve or reject it (once for the whole plan). If approved, run each step afterwards with ssh_run, with the EXACT text. The approval expires when the turn ends or after 30 minutes. Each step: one line and why.",
        {
          summary: z.string().min(1).describe("What it achieves, in one sentence"),
          steps: z.array(z.object({ command: z.string().min(1), why: z.string().min(1) })).min(1).max(20),
        },
        h.plan,
        ro,
      ),
    ],
  });
}

/** Appended to the system prompt of SSH tabs. */
export const sshNote = (hostName: string) =>
  `This tab has an SSH console to "${hostName}" shown to the user next to the chat. Tools: mcp__ssh__ssh_status, ssh_read, ssh_run, ssh_plan. They only work while the user shares the console ("The agent sees the console"); if a tool says it is not shared, ask the user to enable it. Rules: (1) read freely with ssh_read and read-only commands via ssh_run; (2) anything that changes the server goes in ONE plan via ssh_plan (summary + exact single-line steps) that the user approves once, then run each step with ssh_run verbatim; (3) you never see credentials: if a command needs a password (sudo...), ask the user in chat to type it in the console and then use ssh_read; never ask for a password or key in chat and never try to read key files, the vault or its API; (4) the sensitive files (.env, keys, shadow...) are off-limits; (5) do not run ssh/scp yourself, the console is the only way.`;

/** PreToolUse for every agent-os-nexo query: denies tool calls that would reach credentials. Runs in bypass mode too. */
const guard: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse") return {};
  const reason = blockedToolUse(input.tool_name, input.tool_input);
  return reason ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } } : {};
};
export const guardHooks: NonNullable<Options["hooks"]> = { PreToolUse: [{ hooks: [guard] }] };
