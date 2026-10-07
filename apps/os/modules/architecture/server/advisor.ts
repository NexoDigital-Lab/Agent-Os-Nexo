// The architect: an agent compares the real code with the defined architecture and gives concrete steps, or
// answers loose questions. Read-only — it never touches the repository.
import { statSync } from "node:fs";
import path from "node:path";
import { httpError } from "../../../host/server/http.ts";
import { projectPath } from "../../projects/server/projects.ts";
import { safePath } from "../../projects/server/repo.ts";
import { ask, structured } from "../../sessions/server/claude.ts";
import { MAX_CHAT, architecturePrompt, readArch, writeAdvice, writeChat } from "./store.ts";
import type { ArchAdvice, ArchChatMsg, ArchStep } from "./types.ts";

// The Claude calls, replaceable so tests can answer without the SDK (same pattern as the practice module).
export const deps = { structured, ask };

const MAX_STEPS = 12;
const HISTORY = 10;
const PAST_MSG = 1500; // each past message, so a long answer can't bloat every later prompt
const str = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "steps"],
  properties: {
    summary: str,
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "files"],
        properties: { title: str, detail: str, files: { type: "array", items: str } },
      },
    },
  },
};

// One analysis per project at a time: they take a minute and cost money, a double click must not run twice.
const running = new Set<string>();

// Chats of a project run one after another (a queue, not a refusal): two at once would overwrite each other's history.
const chatQueue = new Map<string, Promise<unknown>>();
function queued<T>(project: string, job: () => Promise<T>): Promise<T> {
  const run = (chatQueue.get(project) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  chatQueue.set(project, tail);
  void tail.then(() => chatQueue.get(project) === tail && chatQueue.delete(project));
  return run;
}

const repoOf = (project: string) => {
  const repo = projectPath(project);
  if (!repo) throw httpError(404, `Unknown project or no code/ yet: ${project}`);
  return repo;
};

/** A path the agent mentioned → repo-relative with forward slashes, or null when it's outside the repo or isn't an existing regular file. */
export function cleanFile(repo: string, f: string): string | null {
  try {
    const abs = safePath(repo, f); // rejects '..', absolute paths outside the repo and symlink escapes
    const rel = path.relative(repo, abs);
    return rel && statSync(abs).isFile() ? rel.split(path.sep).join("/") : null;
  } catch {
    return null;
  }
}

const GOAL = {
  start: "Lay out the ORDERED steps to stand this architecture up from the code that already exists: what to create, move or split first, and what comes next.",
  analyze: "Compare the current code with the architecture: say what already complies, what does not (with concrete files) and give the next steps to fix it, by priority.",
};

/** The UI language the answer must be written in. */
export type AnswerLanguage = "en" | "es";
// A register, not just a language: asked only for "Rioplatense", the model reached for slang ("Boludo, …").
const LANG: Record<AnswerLanguage, string> = {
  en: "English, in a professional, friendly tone",
  es: "Spanish with Rioplatense voseo (vos, tenés, fijate), in a professional, friendly tone: no slang, no insults, not even affectionate ones",
};
export const answerLanguage = (v: unknown): AnswerLanguage => (v === "es" ? "es" : "en");

export async function advise(project: string, mode: "start" | "analyze", focus?: string, lang: AnswerLanguage = "en"): Promise<ArchAdvice> {
  const repo = repoOf(project);
  if (running.has(project)) throw httpError(409, "This project is already being analyzed");
  const arch = architecturePrompt(project);
  running.add(project);
  try {
    const prompt = [
      `You are the project's architect. Answer in ${LANG[lang]}, clear and concrete.`,
      arch || "The user has not defined an architecture yet: propose a reasonable one for what you see in the code and lay out the steps to get there.",
      "Before answering, look at the real code with Read, Glob and Grep (the current folder is the repository). Do not invent files or modules.",
      GOAL[mode],
      focus?.trim() ? `Pay special attention to: ${focus.trim().slice(0, 500)}` : "",
      `Return a short summary and between 1 and ${MAX_STEPS} steps. Each step: a short title, a detail with the what and the why, and files with repository-relative paths of files that EXIST and are relevant ([] if none).`,
    ].filter(Boolean).join("\n\n");
    const { out, cost } = await deps.structured<{ summary: string; steps: ArchStep[] }>(prompt, repo, SCHEMA);
    const steps = out.steps.slice(0, MAX_STEPS).map((s) => ({ ...s, files: [...new Set(s.files.map((f) => cleanFile(repo, f)).filter((f): f is string => !!f))] }));
    if (!steps.length) throw httpError(502, "The agent returned no steps");
    const advice: ArchAdvice = { mode, summary: out.summary, steps, createdAt: new Date().toISOString(), cost };
    writeAdvice(project, advice);
    return advice;
  } finally {
    running.delete(project);
  }
}

export function chat(project: string, message: unknown, lang: AnswerLanguage = "en") {
  repoOf(project); // 404 / validation errors surface immediately, not after waiting in the queue
  const text = String(message ?? "").trim();
  if (!text) throw httpError(400, "Write a message");
  if (text.length > 4000) throw httpError(400, "The message is too long");
  return queued(project, () => runChat(project, text, lang));
}

async function runChat(project: string, text: string, lang: AnswerLanguage) {
  const repo = repoOf(project);
  const history = readArch(project).chat;
  const system = [
    `You are the project's architect and help whoever is lost. Answer in ${LANG[lang]}, concise and practical.`,
    "You can look at the code with Read, Glob and Grep (the current folder is the repository); you do not modify it.",
    architecturePrompt(project) || "The user has not defined an architecture for this project yet.",
  ].join("\n\n");
  const past = history.slice(-HISTORY).map((m) => `${m.role === "user" ? "User" : "Architect"}: ${m.text.length > PAST_MSG ? `${m.text.slice(0, PAST_MSG)}…` : m.text}`).join("\n");
  const { text: reply } = await deps.ask(`${past ? `Conversation so far:\n${past}\n\n` : ""}User message: ${text}`, system, repo);
  const at = new Date().toISOString();
  const asked: ArchChatMsg = { role: "user", text, at };
  const answered: ArchChatMsg = { role: "assistant", text: reply, at: new Date().toISOString() };
  const messages = [...history, asked, answered].slice(-MAX_CHAT);
  writeChat(project, messages);
  return { reply, messages };
}

export const clearChat = (project: string) => writeChat(project, []);
