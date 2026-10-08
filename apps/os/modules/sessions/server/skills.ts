// The skills a tab can load: the environment's library/skills (factory and yours) plus the user's own
// ~/.claude/skills. Which ones are off or pinned lives in library/profile.json, so agents in the terminal
// honor the same choice (the environment's AGENTS.md tells them to).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Env } from "../../../host/server/env.ts";
import { askWithProvider, type ProviderId } from "../../../host/server/providers.ts";
import { readJson, writeJson } from "../../../host/server/http.ts";

export interface Skill {
  name: string;
  /** "nexo" (factory), "library" (yours, in the environment) or "claude" (~/.claude/skills). */
  source: "nexo" | "library" | "claude";
  /** SKILL.md size in tokens (~4 chars each): what loading it costs. */
  tokens: number;
  /** Short, one line. */
  description: string;
  enabled: boolean;
  pinned: boolean;
}

export interface SkillPrefs {
  disabled: string[];
  pinned: string[];
}

let env: Env | null = null;

export function initSkills(e: Env): void {
  env = e;
}

const profileFile = () => join(env!.library, "profile.json");

export function readPrefs(): SkillPrefs {
  const p = readJson<{ skills?: Partial<SkillPrefs> }>(profileFile(), {}).skills ?? {};
  return { disabled: p.disabled ?? [], pinned: p.pinned ?? [] };
}

export function writePrefs(prefs: SkillPrefs): void {
  const profile = readJson<Record<string, unknown>>(profileFile(), {});
  writeJson(profileFile(), { ...profile, skills: prefs });
}

/** The language agents answer in (library/profile.json). */
export const userLanguage = (): string => readJson<{ language?: string }>(profileFile(), {}).language ?? "en";

function frontmatter(file: string): Record<string, string> {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["'>|-]\s*/, "").replace(/["']$/, "").trim();
  }
  return out;
}

/** First sentence, capped: the list must stay scannable. */
function shorten(desc: string): string {
  const first = desc.split(/(?<=[.!?])\s/)[0] ?? desc;
  return first.length > 140 ? `${first.slice(0, 137)}…` : first;
}

function skillsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => d !== "synced" && existsSync(join(dir, d, "SKILL.md")));
}

export function listSkills(): Skill[] {
  const prefs = readPrefs();
  const found = new Map<string, { file: string; source: Skill["source"] }>();
  const library = join(env!.library, "skills");
  for (const name of skillsIn(library)) {
    const file = join(library, name, "SKILL.md");
    found.set(name, { file, source: frontmatter(file).owner === "nexo" ? "nexo" : "library" });
  }
  const claude = join(homedir(), ".claude", "skills");
  for (const name of skillsIn(claude)) if (!found.has(name)) found.set(name, { file: join(claude, name, "SKILL.md"), source: "claude" });
  return [...found.entries()]
    .map(([name, { file, source }]) => ({
      name,
      source,
      tokens: Math.round(statSync(file).size / 4),
      description: shorten(frontmatter(file).description ?? ""),
      enabled: !prefs.disabled.includes(name),
      pinned: prefs.pinned.includes(name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Recommendation {
  name: string;
  why: string;
}

const RECOMMEND_SCHEMA = {
  type: "object",
  properties: {
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, why: { type: "string" } },
        required: ["name", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["skills"],
  additionalProperties: false,
};

/** Pinned skills ride along on every task (the web shows "pinned" for an empty why). */
const withPinned = (pool: Skill[], recs: Recommendation[]): Recommendation[] => {
  const list = [...recs];
  for (const s of pool.filter((s) => s.pinned)) if (!list.some((r) => r.name === s.name)) list.push({ name: s.name, why: "" });
  return list;
};

/** A CLI answer is free text: tolerate fences/prose around {"skills":[…]}; anything unparsable is empty. */
function parseCliRecommendations(text: string): Recommendation[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as { skills?: Recommendation[] };
    return Array.isArray(parsed.skills)
      ? parsed.skills.filter((r) => typeof r?.name === "string" && typeof r?.why === "string")
      : [];
  } catch {
    return [];
  }
}

/** Picks a focused loadout for a task with a cheap model call: few skills, rare-signal matches first,
 *  under ~15k tokens. claude keeps the SDK structured-output path; any other selected provider runs
 *  headless through askWithProvider (cost unknown → 0; unparsable answers degrade to pinned only). */
export async function recommendSkills(
  task: string,
  project: string | null,
  run: typeof query = query,
  extra: { provider?: string | null; model?: string; cwd?: string } = {},
) {
  const pool = listSkills().filter((s) => s.enabled);
  const catalog = pool.map((s) => `- ${s.name} (${s.tokens} tok): ${s.description}`).join("\n");
  const viaCli = !!extra.provider && extra.provider !== "claude";
  const prompt = `You pick the skill loadout for a coding agent before it starts a task.

Project: ${project ?? "(none)"}
Task: ${task}

Available skills:
${catalog}

Rules:
- Pick 0-5 skills that the task clearly needs. Fewer is better; do not pad.
- Prefer rare, specific matches over generic ones. Keep the summed tokens under ~15000.
- "why" is one short line in the language with code "${userLanguage()}", max 12 words, saying what the skill will do for THIS task.
- Only use names from the list.${viaCli ? '\n\nAnswer with ONLY a JSON object, no prose, in exactly this shape: {"skills":[{"name":"<name>","why":"<why>"}]}' : ""}`;

  if (viaCli) {
    const answer = await askWithProvider(extra.provider as ProviderId, prompt, {
      cwd: extra.cwd ?? process.cwd(),
      ...(extra.model ? { model: extra.model } : {}),
    });
    const recs = parseCliRecommendations(answer.text).filter((r) => pool.some((s) => s.name === r.name));
    return { skills: withPinned(pool, recs), cost: 0 };
  }

  let recs: Recommendation[] = [];
  let cost = 0;
  for await (const msg of run({
    prompt,
    options: { model: "haiku", tools: [], settingSources: [], persistSession: false, maxTurns: 2, outputFormat: { type: "json_schema", schema: RECOMMEND_SCHEMA } },
  })) {
    if (msg.type === "result") {
      cost = msg.total_cost_usd;
      if (msg.subtype === "success") {
        recs = ((msg.structured_output as { skills?: Recommendation[] })?.skills ?? []).filter((r) => pool.some((s) => s.name === r.name));
      }
    }
  }
  return { skills: withPinned(pool, recs), cost };
}
