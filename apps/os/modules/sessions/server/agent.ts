// One Claude Agent SDK session per tab, several running at once. A tab runs in its project's folder (so
// AGENTS.md, .claude/settings.json and .mcp.json apply as in the terminal) and works on the project's code/
// or one of its worktrees. Other modules add to each turn through contributions.ts.
import type { Response } from "express";
import {
  query,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { join } from "node:path";
import { httpError, readJson, writeJson } from "../../../host/server/http.ts";
import { contributions, mergedHooks, safely, type TabContext, type TurnInfo } from "./contributions.ts";
import { lastTask, translate, type Ev } from "./sdkEvents.ts";
import { createWorkServer, deriveStatus, trackWaiting, WORK_NOTE, WORK_TOOL_PREFIX, type AgentStatus, type TurnEnd, type WorkStatus } from "./status.ts";
import { dropUploads, pruneUploads, uploadPath, userMessage } from "./uploads.ts";
import { findTranscript, transcriptEvents } from "./usage.ts";

export type { Ev };

let TABS_FILE = "";

type Session = TabContext & {
  sdkSessionId?: string;
  events: Ev[];
  clients: Set<Response>;
  running: boolean;
  abort?: AbortController;
  // Each waiting permission prompt: its resolver + the SDK's "don't ask again" rules for it.
  pending: Map<string, { resolve: (r: PermissionResult) => void; suggestions: PermissionUpdate[] }>;
  cost: number;
  forkNext?: boolean; // resumed from a session still live elsewhere: branch off instead of writing into it
  q?: Query;
  input?: Inbox; // open while a query runs: quick prompts are pushed here mid-turn
  last?: Omit<SendOpts, "prompt" | "images">;
  afterRun: string[]; // quick prompts that arrived while the turn was closing — sent as the next turn
  // Agent status (status.ts): derived from the event stream, kept in memory only.
  waiting: Set<string>; // permission prompts and module events waiting for the user
  end: TurnEnd;
  unseen: boolean; // the last turn ended and the user has not opened the tab since
  st: { status: AgentStatus; since: number };
  work?: WorkStatus | null; // set by the agent through the "work" MCP tool; persisted
};

const runtime = () => ({ waiting: new Set<string>(), end: null as TurnEnd, unseen: false, st: { status: "idle" as AgentStatus, since: Date.now() } });

/** Re-derives the tab's status; `since` moves only when it changes. */
function refresh(s: Session): AgentStatus {
  const status = deriveStatus({ running: s.running, waiting: s.waiting.size, end: s.end, unseen: s.unseen });
  if (status !== s.st.status) s.st = { status, since: Date.now() };
  return status;
}

/** Minimal async queue: the query's streaming input. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake?: () => void;
  closed = false;
  push(m: SDKUserMessage) {
    if (this.closed) return false;
    this.items.push(m);
    this.wake?.();
    return true;
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.items.length) yield this.items.shift()!;
      else if (this.closed) return;
      else await new Promise<void>((r) => (this.wake = r));
    }
  }
}

const sessions = new Map<string, Session>();

type SavedTab = TabContext & { sdkSessionId?: string; cost: number; forkNext?: boolean; work?: WorkStatus | null };

const ctxOf = (s: Session): TabContext => ({ id: s.id, title: s.title, project: s.project, dir: s.dir, cwd: s.cwd, worktree: s.worktree, meta: s.meta });

function persist() {
  const tabs: SavedTab[] = [...sessions.values()].map((s) => ({ ...ctxOf(s), sdkSessionId: s.sdkSessionId, cost: s.cost, forkNext: s.forkNext, work: s.work }));
  writeJson(TABS_FILE, tabs);
}

const fresh = () => ({ events: [] as Ev[], clients: new Set<Response>(), running: false, pending: new Map(), cost: 0, afterRun: [] as string[], ...runtime() });

/** Tabs survive a server restart: metadata + SDK session id, so the next send resumes the conversation. */
export function restoreTabs(tabsFile: string): void {
  TABS_FILE = tabsFile;
  // A damaged tabs.json is kept aside by readJson and the app starts with no tabs, instead of not starting at all.
  const saved = readJson<SavedTab[]>(TABS_FILE, []);
  for (const t of Array.isArray(saved) ? saved : []) {
    const file = t.sdkSessionId ? findTranscript(t.sdkSessionId) : null;
    const events: Ev[] = file
      ? [...(transcriptEvents(file) as Ev[]), { kind: "note", text: "agent-os restarted. This is the saved history; the next message continues the conversation." }]
      : [];
    sessions.set(t.id, { ...fresh(), ...t, meta: t.meta ?? {}, worktree: t.worktree ?? null, events });
  }
  pruneUploads((tab) => sessions.has(tab));
}

export interface OpenTab {
  project: string;
  dir: string;
  cwd: string;
  title: string;
  worktree?: string | null;
  meta?: Record<string, unknown>;
}

export function openTab(o: OpenTab): string {
  const id = crypto.randomUUID().slice(0, 8);
  sessions.set(id, { ...fresh(), id, title: o.title, project: o.project, dir: o.dir, cwd: o.cwd, worktree: o.worktree ?? null, meta: o.meta ?? {} });
  persist();
  return id;
}

/** Tab already bound to this Claude session, if any. */
export function tabForSession(sdkSessionId: string): string | null {
  for (const s of sessions.values()) if (s.sdkSessionId === sdkSessionId) return s.id;
  return null;
}

/** Opens a tab that continues an existing Claude session, showing its recent history. */
export function resumeTab(o: OpenTab & { sdkSessionId: string; fork: boolean; history: Ev[] }): string {
  const id = crypto.randomUUID().slice(0, 8);
  const note: Ev = {
    kind: "note",
    text: o.fork
      ? "Session resumed as a copy: it is still live elsewhere, so the next message starts a new branch and leaves the original alone."
      : "Session resumed. The next message continues this conversation.",
  };
  sessions.set(id, {
    ...fresh(), id, title: o.title, project: o.project, dir: o.dir, cwd: o.cwd, worktree: o.worktree ?? null, meta: o.meta ?? {},
    sdkSessionId: o.sdkSessionId, forkNext: o.fork, events: [...o.history, note],
  });
  persist();
  return id;
}

export function renameTab(id: string, title: string): void {
  const s = sessions.get(id);
  if (s) {
    s.title = title;
    persist();
  }
}

/** Sets one module's value on a tab (e.g. architecture's archOff); takes effect on the next turn. */
export function setTabMeta(id: string, key: string, value: unknown): void {
  const s = get(id);
  if (value === undefined || value === null) delete s.meta[key];
  else s.meta[key] = value;
  persist();
}

export function listTabs() {
  return [...sessions.values()].map((s) => {
    const status = refresh(s);
    return { ...ctxOf(s), running: s.running, cost: s.cost, sdkSessionId: s.sdkSessionId ?? null, status, statusSince: s.st.since, workStatus: s.work ?? null };
  });
}

export type TabInfo = ReturnType<typeof listTabs>[number];

/** What a contribution or route needs to know about a tab, or null. */
export function tabContext(id: string): TabContext | null {
  const s = sessions.get(id);
  return s ? ctxOf(s) : null;
}

/** The user opened the tab: a finished/failed turn is no longer news. */
export function markSeen(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.unseen = false;
  refresh(s);
}

/** The repository a tab works on (code/ or its worktree): the root for its files, git and terminals. */
export function tabCwd(id: string): string {
  return get(id).cwd;
}

function get(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw httpError(404, "Unknown tab");
  return s;
}

function emit(s: Session, ev: Ev): void {
  s.events.push(ev);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of s.clients) c.write(line);
  if (trackWaiting(s.waiting, ev)) refresh(s);
}

/** Adds an event to a tab's stream from outside a turn (e.g. an SSH plan decided in the UI). */
export function emitTo(id: string, ev: Ev): void {
  const s = sessions.get(id);
  if (s) emit(s, ev);
}

export type WorkMode = "relax" | "focus" | "practice";
type SendOpts = { prompt: string; skills: string[]; images: string[]; mode: PermissionMode; model?: string; workMode?: WorkMode };

// The work-mode dial, per message (see the nexo-dev skill).
const WORK_MODE: Record<WorkMode, string> = {
  relax: "",
  focus:
    "Work mode: FOCUS. Before writing code in each sector (a coherent unit: data layer, endpoint, UI component), stop and give a short briefing (sector · logic · key data · contract, as bullets) and wait for the user's OK. Checkpoint per sector, not per file.",
  practice:
    "Work mode: PRACTICE. The user writes all the project code; you guide. Do not Edit/Write project source, tests or code unless the user explicitly asks for it in this message. Config/env/infra you may handle directly. Help on a ladder, lowest step first: pointer (what to look at) → approach in words → skeleton with TODO holes → real snippet only if asked. When asked to review, point to file:line and why; do not fix it. Stay in the scope the user names.",
};

function systemNote(s: Session, opts: SendOpts): string {
  const where = s.project
    ? `project ${s.project}; the repository is ${s.worktree ? `worktrees/${s.worktree}/ (a git worktree of code/ — work there, not in code/)` : "code/"}`
    : "no project";
  const loadout = opts.skills.length
    ? `The user approved this skill loadout for the task: ${opts.skills.join(", ")}. Use these; if you need one that is not listed, say so instead of invoking it.`
    : "The user approved no skills for this task. Do not invoke skills.";
  const work = opts.workMode ? WORK_MODE[opts.workMode] : "";
  const notes = contributions().map((c) => safely(() => c.promptNote?.(ctxOf(s)), null)).filter(Boolean);
  return [`Session launched from agent-os (the Nexo web UI; ${where}). ${loadout}`, work, ...notes, WORK_NOTE].filter(Boolean).join("\n");
}

export function send(id: string, opts: SendOpts): void {
  const s = get(id);
  if (s.running) throw httpError(409, "A task is already running in this tab");
  s.running = true;
  s.end = null;
  s.unseen = false;
  refresh(s);
  s.abort = new AbortController();
  emit(s, { kind: "status", running: true });
  const images = opts.images.filter((n) => uploadPath(id, n));
  emit(s, { kind: "user", text: opts.prompt, skills: opts.skills, images: images.map((n) => `/api/tabs/${id}/uploads/${n}`) });

  s.last = { skills: opts.skills, mode: opts.mode, model: opts.model, workMode: opts.workMode };
  const input = new Inbox();
  input.push(userMessage(id, opts.prompt, images));
  s.input = input;
  const ctx = ctxOf(s);
  const signal = s.abort.signal;

  void (async () => {
    let turns = 0;
    let ok = false;
    let failed = false;
    const env = Object.assign({}, ...contributions().map((c) => safely(() => c.env?.(ctx), null) ?? {})) as Record<string, string>;
    const mcp = Object.assign(
      { work: createWorkServer((w) => ((s.work = w), persist())) },
      ...contributions().map((c) => safely(() => c.mcpServers?.(ctx, { emit: (ev) => emit(s, ev), signal }), null) ?? {}),
    );
    try {
      const q = query({
        prompt: input,
        options: {
          cwd: s.dir,
          env: Object.keys(env).length ? { ...process.env, ...env } : undefined,
          resume: s.sdkSessionId,
          forkSession: s.forkNext || undefined,
          model: opts.model || undefined,
          settingSources: ["user", "project", "local"],
          systemPrompt: { type: "preset", preset: "claude_code", append: systemNote(s, opts) },
          mcpServers: mcp,
          hooks: mergedHooks(),
          skills: opts.skills,
          permissionMode: opts.mode,
          allowDangerouslySkipPermissions: opts.mode === "bypassPermissions",
          abortController: s.abort,
          title: s.title,
          canUseTool: (tool, input, { signal: toolSignal, suggestions = [] }) =>
            tool.startsWith(WORK_TOOL_PREFIX) || contributions().some((c) => safely(() => !!c.autoAllow?.(ctx, tool), false))
              ? Promise.resolve<PermissionResult>({ behavior: "allow", updatedInput: input })
              : new Promise<PermissionResult>((resolve) => {
                  const permId = crypto.randomUUID();
                  // Mode switches stay the user's call (the selector), never a side effect of "Always allow".
                  const kept = suggestions.filter((u) => u.type !== "setMode");
                  s.pending.set(permId, { resolve, suggestions: kept });
                  toolSignal.addEventListener("abort", () => {
                    s.pending.delete(permId);
                    resolve({ behavior: "deny", message: "aborted" });
                  });
                  emit(s, { kind: "perm", id: permId, tool, input, always: describeAlways(kept) });
                }),
        },
      });
      s.q = q;
      for await (const msg of q) {
        translate(s, msg, (ev) => emit(s, ev));
        for (const c of contributions()) safely(() => c.onMessage?.(ctx, msg), undefined);
        // Streaming input keeps the query alive between turns; end it once nothing else is queued.
        if (msg.type === "result" && !msg.queued_turn_count) input.close();
        if (msg.type === "system" && msg.subtype === "init") {
          s.forkNext = false; // the fork now has its own session id
          persist();
        }
        if (msg.type === "result") {
          turns = msg.num_turns;
          ok = msg.subtype === "success" && !msg.is_error;
        }
      }
    } catch (e) {
      failed = !signal.aborted;
      emit(s, { kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      input.close();
      s.q = undefined;
      s.input = undefined;
      emit(s, { kind: "activity", tool: null });
      s.running = false;
      s.pending.clear();
      s.waiting.clear();
      // A turn the user stopped is not news; one that failed (or ended in an error result) is.
      s.end = signal.aborted ? null : failed || !ok ? "error" : "ok";
      s.unseen = s.end !== null;
      refresh(s);
      emit(s, { kind: "status", running: false });
      persist();
      const info: TurnInfo = { prompt: opts.prompt, skills: opts.skills, cost: s.cost, turns, ok };
      for (const c of contributions()) safely(() => c.onTurnEnd?.(ctx, info), undefined);
      const queued = s.afterRun.splice(0);
      if (queued.length && sessions.has(id)) send(id, { prompt: queued.join("\n\n"), images: [], ...(s.last ?? { skills: [], mode: "default" }) });
    }
  })();
}

const WHERE: Record<string, string> = {
  localSettings: "the project's .claude/settings.local.json",
  projectSettings: "the project's .claude/settings.json",
  userSettings: "~/.claude/settings.json",
  session: "this session",
};

/** Human summary of the rules "Always allow" would save, or undefined when the SDK offers none. */
function describeAlways(sug: PermissionUpdate[]) {
  const rules = sug.flatMap((u) =>
    u.type === "addRules" && u.behavior === "allow"
      ? u.rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
      : u.type === "addDirectories"
        ? u.directories.map((d) => `access to ${d}`)
        : [],
  );
  if (!rules.length) return undefined;
  return { rules, where: [...new Set(sug.map((u) => WHERE[u.destination] ?? u.destination))].join(", ") };
}

/** `always` also applies the SDK's suggested rules, so the same kind of call isn't asked again. */
export function answerPermission(id: string, permId: string, allow: boolean, always = false): boolean {
  const s = sessions.get(id);
  const p = s?.pending.get(permId);
  if (!s || !p) return false;
  s.pending.delete(permId);
  p.resolve(
    allow
      ? { behavior: "allow", ...(always && p.suggestions.length ? { updatedPermissions: p.suggestions } : {}) }
      : { behavior: "deny", message: "The user denied it from agent-os" },
  );
  emit(s, { kind: "perm_done", id: permId, allow });
  return true;
}

/**
 * Quick prompt. Running: folded into the current turn (streaming input). With a target subagent,
 * that subagent is stopped first and the main agent is told to redirect it. Idle: a normal send.
 */
export async function quickPrompt(id: string, text: string, target?: string) {
  const s = get(id);
  let body = text;
  let label = "main agent";
  if (target) {
    const t = lastTask(s, target);
    label = t ? `${t.type} · ${t.description}` : target;
    if (t?.status === "running") await s.q?.stopTask(target).catch(() => {});
    body = `[Quick message for the subagent "${label}", which I just stopped] ${text}\nRelaunch it or continue its work with this instruction.`;
  }
  if (s.running && s.input && !s.input.closed && s.input.push(userMessage(id, body))) {
    emit(s, { kind: "user", text, skills: [], images: [], quick: label });
    return { queued: true };
  }
  if (s.running) {
    // The turn is closing (e.g. waiting on background tasks): run it right after.
    s.afterRun.push(body);
    emit(s, { kind: "user", text, skills: [], images: [], quick: label });
    emit(s, { kind: "note", text: "Queued: it goes out as soon as the current turn ends." });
    return { queued: true };
  }
  send(id, { prompt: body, images: [], ...(s.last ?? { skills: [], mode: "default" }) });
  return { queued: false };
}

export async function stopTask(id: string, taskId: string): Promise<void> {
  const s = get(id);
  if (!s.q) throw httpError(409, "Nothing is running in this tab");
  await s.q.stopTask(taskId);
}

export function interrupt(id: string): void {
  sessions.get(id)?.abort?.abort();
}

const closeListeners: Array<(id: string) => void> = [];

/** Other modules' cleanup when a tab closes (terminals, language servers, practice state). */
export function onTabClose(fn: (id: string) => void): void {
  closeListeners.push(fn);
}

export function closeTab(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.abort?.abort();
  // After the abort (it rejects anything waiting, which still writes to clients) and before they close.
  for (const c of contributions()) safely(() => c.onClose?.(ctxOf(s)), undefined);
  for (const fn of closeListeners) safely(() => fn(id), undefined);
  for (const c of s.clients) c.end();
  sessions.delete(id);
  dropUploads(id);
  persist();
}

export function subscribe(id: string, res: Response): void {
  const s = get(id);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  for (const ev of s.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  res.write(`data: ${JSON.stringify({ kind: "status", running: s.running })}\n\n`);
  // Never stored in history: tells the client the replay ended, so it can swap it in at once.
  res.write(`data: ${JSON.stringify({ kind: "replay_done" })}\n\n`);
  s.clients.add(res);
  res.on("close", () => s.clients.delete(res));
}

export const tabsFileName = (dataDir: string) => join(dataDir, "tabs.json");
