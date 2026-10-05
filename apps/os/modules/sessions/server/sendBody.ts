// The body of POST /api/tabs/:id/send, checked before anything about the tab changes: a malformed request used
// to leave the tab "working" forever (rule R3). Anything that reaches the agent is typed and bounded here.
import { httpError } from "../../../host/server/http.ts";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { WorkMode } from "./agent.ts";

export interface SendBody {
  prompt: string;
  skills: string[];
  images: string[];
  mode: PermissionMode;
  model?: string;
  workMode?: WorkMode;
}

const MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];
const WORK_MODES: readonly WorkMode[] = ["relax", "focus", "practice"];
const MAX_PROMPT = 100_000;
const SKILL = /^[\w:.-]{1,80}$/;
const IMAGE = /^[\w.-]{1,120}$/;
const MODEL = /^[\w.-]{1,80}$/;

const list = (v: unknown, field: string, re: RegExp, max: number): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === "string" && re.test(x))) {
    throw httpError(400, `${field} must be a list of at most ${max} names`);
  }
  return v as string[];
};

export function parseSendBody(b: unknown): SendBody {
  const body = (b ?? {}) as Record<string, unknown>;
  if (typeof body.prompt !== "string" || !body.prompt.trim()) throw httpError(400, "prompt must be non-empty text");
  if (body.prompt.length > MAX_PROMPT) throw httpError(413, `prompt is longer than ${MAX_PROMPT} characters`);
  const mode = body.mode ?? "default";
  if (!MODES.includes(mode as PermissionMode)) throw httpError(400, `mode must be one of: ${MODES.join(", ")}`);
  if (body.model !== undefined && body.model !== null && (typeof body.model !== "string" || !MODEL.test(body.model))) throw httpError(400, "Invalid model");
  if (body.workMode !== undefined && body.workMode !== null && !WORK_MODES.includes(body.workMode as WorkMode)) throw httpError(400, `workMode must be one of: ${WORK_MODES.join(", ")}`);
  return {
    prompt: body.prompt,
    skills: list(body.skills, "skills", SKILL, 20),
    images: list(body.images, "images", IMAGE, 10),
    mode: mode as PermissionMode,
    model: (body.model as string | undefined) || undefined,
    workMode: (body.workMode as WorkMode | undefined) ?? undefined,
  };
}
