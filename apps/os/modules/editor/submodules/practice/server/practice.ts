// Practice: the AI plans and reviews, the user writes the code. The AI only gets read tools here.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { httpError, readJson, run, writeJson } from "../../../../../host/server/http.ts";
import { MODEL, READ_ONLY, structured } from "../../../../sessions/server/claude.ts";
import { userLanguage } from "../../../../sessions/server/skills.ts";
import { readText } from "../../../server/files.ts";

let DIR = "";

/** Where each tab's plan and review live (this submodule's data folder). */
export function initPractice(dataDir: string): void {
  DIR = dataDir;
  mkdirSync(DIR, { recursive: true });
}

const lang = () => `the language with code "${userLanguage()}"`;

export type Step = {
  id: string;
  file: string;
  isNew: boolean;
  goal: string;
  why: string;
  line: number; // where the user's margin goes (1-based)
  mode: "insert" | "edit";
  endLine: number; // for "edit": last line of the block to rework
  pointer: string;
  approach: string;
  skeleton: string;
  checks: string[];
};
type TermTask = { id: string; goal: string; hint: string; command: string };
export type Plan = { task: string; title: string; summary: string; steps: Step[]; terminal: TermTask[]; cost: number; createdAt: string };

type StepReview = { id: string; status: "ok" | "partial" | "pending" | "problem"; feedback: string; issues: { file: string; line: number; msg: string }[] };
export type Review = {
  verdict: "done" | "almost" | "missing";
  overall: string;
  steps: StepReview[];
  terminal: { id: string; status: "ok" | "pending" | "problem"; feedback: string }[];
  next: string;
  cost: number;
  at: string;
};

const str = { type: "string" };
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "steps", "terminal"],
  properties: {
    title: str,
    summary: str,
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "file", "isNew", "goal", "why", "line", "mode", "endLine", "pointer", "approach", "skeleton", "checks"],
        properties: {
          id: str, file: str, isNew: { type: "boolean" }, goal: str, why: str,
          line: { type: "integer" }, mode: { type: "string", enum: ["insert", "edit"] }, endLine: { type: "integer" },
          pointer: str, approach: str, skeleton: str, checks: { type: "array", items: str },
        },
      },
    },
    terminal: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "goal", "hint", "command"],
        properties: { id: str, goal: str, hint: str, command: str },
      },
    },
  },
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "overall", "steps", "terminal", "next"],
  properties: {
    verdict: { type: "string", enum: ["done", "almost", "missing"] },
    overall: str,
    next: str,
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "feedback", "issues"],
        properties: {
          id: str,
          status: { type: "string", enum: ["ok", "partial", "pending", "problem"] },
          feedback: str,
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["file", "line", "msg"],
              properties: { file: str, line: { type: "integer" }, msg: str },
            },
          },
        },
      },
    },
    terminal: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "feedback"],
        properties: { id: str, status: { type: "string", enum: ["ok", "pending", "problem"] }, feedback: str },
      },
    },
  },
};

const file = (tabId: string) => path.join(DIR, `${tabId}.json`);

export const readPractice = (tabId: string) => readJson<{ plan: Plan | null; review: Review | null }>(file(tabId), { plan: null, review: null });

function save(tabId: string, data: { plan: Plan | null; review: Review | null }) {
  writeJson(file(tabId), data);
}

export async function makePlan(tabId: string, cwd: string, projectDir: string, task: string) {
  const context = path.join(projectDir, "context");
  const hasContext = existsSync(context);
  const prompt = `You are the user's programming tutor. They will write ALL the code of this task to practice; you do NOT write project code.
Task they want to practice: ${task}

Repository: ${cwd}${hasContext ? `\nProject context (read only): ${context}: business rules, decisions and features, if they help.` : ""}

Explore the code with Read/Glob/Grep and build a practice plan:
- steps: 2 to 7 small steps, in order. Each one = one concrete file (path relative to the repository) and one single thing to write.
  - isNew: true if the file doesn't exist yet.
  - line: the line number (1-based) where the user starts writing. For new files: 1.
  - mode "insert" = new code at that line; "edit" = rewrite the block line..endLine (for insert, endLine = line).
  - goal: what it has to achieve (1 sentence). why: why it goes there (1 sentence).
  - Hints on a ladder, from least to most help: pointer (what to look at / which concept, no code), approach (the flow in words, no code), skeleton (signature or pseudocode with "// TODO" holes, NEVER the full solution).
  - checks: 1-3 verifiable criteria for when they validate.
- terminal: 1-4 terminal tasks that make sense for this task (git: create a branch, look at status/diff, stage, commit with a good message; or config: .env, scripts). command = the expected command (shown only if they ask).
- a short title and a 2-line summary.
Write every text in ${lang()}. Follow the conventions you see in the repository.`;
  const { out, cost } = await structured<Omit<Plan, "task" | "cost" | "createdAt">>(prompt, cwd, PLAN_SCHEMA, hasContext ? [context] : []);
  const plan: Plan = { ...out, task, cost, createdAt: new Date().toISOString() };
  save(tabId, { plan, review: null });
  return plan;
}

export async function snippet(tabId: string, cwd: string, stepId: string) {
  const { plan } = readPractice(tabId);
  const step = plan?.steps.find((s) => s.id === stepId);
  if (!plan || !step) throw httpError(404, "Step not found");
  const current = readText(cwd, step.file).content;
  let text = "";
  let cost = 0;
  for await (const msg of query({
    prompt: `The user is practicing and asked for the real snippet of this step. Give it short, explained in 2-3 lines in ${lang()}. Only this step's code, not the whole feature.
Step: ${step.goal}
File: ${step.file} (${step.mode} at line ${step.line})
Current content of the file:
\`\`\`
${current.slice(0, 20000)}
\`\`\``,
    options: { cwd, model: MODEL, tools: READ_ONLY, allowedTools: READ_ONLY, settingSources: [], persistSession: false, maxTurns: 8 },
  })) {
    if (msg.type === "result") {
      cost = msg.total_cost_usd;
      if (msg.subtype === "success") text = msg.result;
    }
  }
  return { text, cost };
}

export async function validate(tabId: string, cwd: string) {
  const data = readPractice(tabId);
  if (!data.plan) throw httpError(400, "Make a practice plan first");
  const git = async (...a: string[]) => (await run("git", a, { cwd, maxBuffer: 16 * 1024 * 1024 }).catch(() => ({ stdout: "" }))).stdout;
  const [branch, status, diff, log, untracked] = await Promise.all([
    git("branch", "--show-current"),
    git("status", "--short"),
    git("diff", "HEAD"),
    git("log", "-6", "--format=%h %s (%cr)"),
    git("ls-files", "--others", "--exclude-standard"),
  ]);
  const newFiles = untracked
    .split("\n")
    .filter(Boolean)
    .slice(0, 12)
    .map((f) => `--- ${f} (new)\n${readText(cwd, f).content.slice(0, 6000)}`)
    .join("\n\n");

  const prompt = `You are the tutor. The user wrote the code of their practice and pressed "Check". Review it against the plan.
You fix NOTHING: give concrete feedback with file:line and the why. A friendly, direct teacher's tone, in ${lang()}. Acknowledge what is right.

PLAN:
${JSON.stringify(data.plan.steps.map(({ id, file, goal, checks }) => ({ id, file, goal, checks })), null, 2)}
Terminal tasks: ${JSON.stringify(data.plan.terminal.map(({ id, goal }) => ({ id, goal })))}

GIT STATE
branch: ${branch.trim()}
status:
${status || "(clean)"}
last commits:
${log}

DIFF (vs HEAD):
${diff.slice(0, 60000) || "(no changes in tracked files)"}

NEW FILES:
${newFiles || "(none)"}

You can read more files with Read/Glob/Grep if you need context. Return:
- steps: one item per plan step (same id) with status ok / partial / pending / problem, feedback of 1-3 sentences, issues with file (relative path) + line + msg.
- terminal: one item per terminal task: does it look done in the git state (branch, commits, messages)?
- verdict: done / almost / missing. overall: 2-3 sentences. next: the concrete next step.`;
  const { out, cost } = await structured<Omit<Review, "cost" | "at">>(prompt, cwd, REVIEW_SCHEMA);
  const review: Review = { ...out, cost, at: new Date().toISOString() };
  save(tabId, { plan: data.plan, review });
  return review;
}

export function dropPractice(tabId: string) {
  rmSync(file(tabId), { force: true });
}
