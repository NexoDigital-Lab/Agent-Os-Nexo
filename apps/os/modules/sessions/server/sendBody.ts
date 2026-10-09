// The body of POST /api/tabs/:id/send, checked before anything about the tab changes: a malformed request used
// to leave the tab "working" forever (rule R3). Anything that reaches the agent is typed and bounded here.
import { httpError } from "../../../host/server/http.ts";
import { CHOICE_RE, providerById, type ProviderId } from "../../../host/server/providers.ts";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { FRAMEWORK_NAME, NEXO_METHOD } from "../../../host/server/frameworks.ts";
import type { WorkMode } from "./agent.ts";

export interface SendBody {
  prompt: string;
  skills: string[];
  images: string[];
  mode: PermissionMode;
  model?: string;
  agent?: string;
  workMode?: WorkMode;
  /** Registry provider id; missing/unknown falls back to the session's current provider (or the active default). */
  provider?: ProviderId;
  /** "nexo" (no framework) or an enabled method; missing keeps the tab's framework (or the environment's default). */
  framework?: string;
}

const MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];
const WORK_MODES: readonly WorkMode[] = ["relax", "focus", "practice"];
const MAX_PROMPT = 100_000;
const SKILL = /^[\w:.-]{1,80}$/;
const IMAGE = /^[\w.-]{1,120}$/;
const MODEL = /^[\w.-]{1,80}$/; // claude SDK model enum (sonnet/opus/haiku); CLI provider/model ids use CHOICE_RE
const AGENT = /^[A-Za-z0-9._-]{1,100}$/;

const list = (v: unknown, field: string, re: RegExp, max: number): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === "string" && re.test(x))) {
    throw httpError(400, `${field} must be a list of at most ${max} names`);
  }
  return v as string[];
};

/** `methods`: the names of the enabled methods a tab may pick; when given, `framework` must be "nexo" or one of them. */
export function parseSendBody(b: unknown, methods?: readonly string[]): SendBody {
  const body = (b ?? {}) as Record<string, unknown>;
  if (typeof body.prompt !== "string" || !body.prompt.trim()) throw httpError(400, "prompt must be non-empty text");
  if (body.prompt.length > MAX_PROMPT) throw httpError(413, `prompt is longer than ${MAX_PROMPT} characters`);
  const mode = body.mode ?? "default";
  if (!MODES.includes(mode as PermissionMode)) throw httpError(400, `mode must be one of: ${MODES.join(", ")}`);
  // Model: claude keeps its enum regex; a CLI provider's body uses the shared validator (provider/model with / and :).
  if (body.model !== undefined && body.model !== null) {
    if (typeof body.model !== "string") throw httpError(400, "Invalid model");
    const kind = body.provider !== undefined && body.provider !== null ? providerById(body.provider as string)?.kind : undefined;
    const re = kind === "cli" ? CHOICE_RE : MODEL;
    if (!re.test(body.model)) throw httpError(400, "Invalid model");
  }
  if (body.agent !== undefined && body.agent !== null && (typeof body.agent !== "string" || !AGENT.test(body.agent))) throw httpError(400, "Invalid agent");
  if (body.workMode !== undefined && body.workMode !== null && !WORK_MODES.includes(body.workMode as WorkMode)) throw httpError(400, `workMode must be one of: ${WORK_MODES.join(", ")}`);
  let provider: ProviderId | undefined;
  if (body.provider !== undefined && body.provider !== null) {
    if (typeof body.provider !== "string" || !providerById(body.provider)) throw httpError(400, `Unknown provider: ${String(body.provider)}`);
    provider = body.provider as ProviderId;
  }
  let framework: string | undefined;
  if (body.framework !== undefined && body.framework !== null && body.framework !== "") {
    if (typeof body.framework !== "string" || (body.framework !== NEXO_METHOD && !FRAMEWORK_NAME.test(body.framework))) throw httpError(400, "Invalid framework");
    if (methods && body.framework !== NEXO_METHOD && !methods.includes(body.framework)) throw httpError(400, `The framework "${body.framework}" is not an enabled method: enable it in Frameworks`);
    framework = body.framework;
  }
  return {
    prompt: body.prompt,
    skills: list(body.skills, "skills", SKILL, 20),
    images: list(body.images, "images", IMAGE, 10),
    mode: mode as PermissionMode,
    model: (body.model as string | undefined) || undefined,
    agent: (body.agent as string | undefined) || undefined,
    workMode: (body.workMode as WorkMode | undefined) ?? undefined,
    provider,
    framework,
  };
}
