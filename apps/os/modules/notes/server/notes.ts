// The notepad: free notes per project (an existing one, or a name for a project that doesn't exist yet), kept in
// os/data/notes. An AI reads them and proposes features; accepted ones become context/features/ files, or wait
// here as drafts until their project exists.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { httpError, readJson } from "../../../host/server/http.ts";
import { listFeatures, writeFeature, type Feature } from "../../projects/server/features.ts";
import { projectDir, projectPath } from "../../projects/server/projects.ts";
import { userLanguage } from "../../sessions/server/skills.ts";

let NOTES = "";
let DRAFTS = "";

export function initNotes(dataDir: string): void {
  NOTES = path.join(dataDir, "notes.json");
  DRAFTS = path.join(dataDir, "drafts.json");
}

export interface Note {
  id: string;
  title: string;
  /** A project id, or the name of a project that doesn't exist yet. */
  project: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  analyzedAt?: string;
}

/** A feature the AI proposed, editable before it is saved. */
export interface Proposal {
  title: string;
  type: Feature["type"];
  priority: Feature["priority"];
  size: Feature["size"];
  description: string;
  criteria: string[];
  why: string;
  sourceNotes: string[];
}

/** A proposal accepted for a project that doesn't exist yet. */
export type Draft = Omit<Proposal, "why"> & { id: string; project: string; createdAt: string };

const read = <T>(file: string): T[] => readJson<T[]>(file, []);
const write = (file: string, rows: unknown[]) => writeFileSync(file, JSON.stringify(rows, null, 2));
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID().slice(0, 8);

const cleanProject = (p: unknown) => {
  const name = String(p ?? "").trim();
  if (!/^[\w .\/-]{1,80}$/.test(name) || name.startsWith(".") || name.includes("..")) throw httpError(400, "Invalid project name");
  return name;
};

// ---- notes
export const listNotes = () => read<Note>(NOTES).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export function saveNote(input: Partial<Note>): Note {
  const notes = read<Note>(NOTES);
  const existing = input.id ? notes.find((n) => n.id === input.id) : undefined;
  const note: Note = {
    id: existing?.id ?? newId(),
    title: String(input.title ?? existing?.title ?? "").slice(0, 140),
    project: cleanProject(input.project ?? existing?.project ?? "general"),
    body: String(input.body ?? existing?.body ?? ""),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    analyzedAt: existing?.analyzedAt,
  };
  write(NOTES, existing ? notes.map((n) => (n.id === note.id ? note : n)) : [note, ...notes]);
  return note;
}

export function deleteNote(id: string): void {
  write(NOTES, read<Note>(NOTES).filter((n) => n.id !== id));
}

// ---- features and drafts
export const listDrafts = () => read<Draft>(DRAFTS);

/** Saves accepted proposals: as features when the project exists, as drafts otherwise. */
export function acceptProposals(project: string, proposals: Proposal[]): { features: string[]; drafts: number } {
  const p = cleanProject(project);
  const dir = projectDir(p);
  if (dir) {
    const features = proposals.map((x) => writeFeature(dir, { title: x.title, type: x.type, size: x.size, priority: x.priority, context: x.description, criteria: x.criteria.filter(Boolean) }));
    return { features, drafts: 0 };
  }
  const drafts: Draft[] = proposals.map(({ why: _why, ...x }) => ({ ...x, id: newId(), project: p, createdAt: now() }));
  write(DRAFTS, [...drafts, ...read<Draft>(DRAFTS)]);
  return { features: [], drafts: drafts.length };
}

/** Turns a project's drafts into features once the project exists. */
export function promoteDrafts(project: string): string[] {
  const dir = projectDir(project);
  if (!dir) throw httpError(409, `The project ${project} doesn't exist yet`);
  const all = read<Draft>(DRAFTS);
  const mine = all.filter((d) => d.project === project);
  const slugs = mine.map((d) => writeFeature(dir, { title: d.title, type: d.type, size: d.size, priority: d.priority, context: d.description, criteria: d.criteria }));
  write(DRAFTS, all.filter((d) => d.project !== project));
  return slugs;
}

export function deleteDraft(id: string): void {
  write(DRAFTS, read<Draft>(DRAFTS).filter((d) => d.id !== id));
}

// ---- analysis
const str = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "features"],
  properties: {
    summary: str,
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "type", "priority", "size", "description", "criteria", "why", "sourceNotes"],
        properties: {
          title: str,
          type: { type: "string", enum: ["feature", "bug", "chore"] },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          size: { type: "string", enum: ["S", "M", "L"] },
          description: str,
          criteria: { type: "array", items: str },
          why: str,
          sourceNotes: { type: "array", items: str },
        },
      },
    },
  },
};

export async function analyze(noteIds: string[]) {
  const notes = read<Note>(NOTES).filter((n) => noteIds.includes(n.id));
  if (!notes.length) throw httpError(400, "Pick at least one note");
  const projects = [...new Set(notes.map((n) => n.project))];
  if (projects.length > 1) throw httpError(400, "Analyze the notes of one project at a time");
  const project = projects[0]!;
  const dir = projectDir(project);
  const repo = projectPath(project);
  const open = dir ? listFeatures(dir).filter((f) => f.status !== "done") : listDrafts().filter((d) => d.project === project);
  const lang = userLanguage();

  const prompt = `You are the user's technical PM. Turn their loose notes into actionable features for the project "${project}".
${dir ? `The project EXISTS: ${dir} (AGENTS.md, context/ with business rules and features${repo ? `, code/ with the repository` : ""}). Before proposing, look at it (Read/Glob/Grep) so you don't ask for something already done and so the criteria name real files, screens or endpoints.` : "It is a NEW project (no folder yet): the features start from scratch; put the foundational ones first (setup, structure) if the notes imply them."}

NOTES:
${notes.map((n) => `--- note ${n.id}: ${n.title || "(untitled)"}\n${n.body}`).join("\n\n")}

FEATURES ALREADY OPEN in this project (do not duplicate them; if a note extends one, say so in "why"):
${open.length ? open.map((f) => `- ${f.title}`).join("\n") : "(none)"}

Rules:
- One feature = one unit of work that can be finished and verified. Split big ones; merge repeated ones.
- type: feature / bug / chore. priority P0 (urgent) … P3 (someday). size S/M/L (S: 1-3 files and no risk; M: several files or one risk; L: cross-cutting or a new module).
- description: 2-4 sentences, what and why. criteria: 2-5 verifiable acceptance criteria.
- why: one line on why you proposed it this way. sourceNotes: ids of the notes it comes from.
- Don't invent work the notes don't ask for.
- Write titles, descriptions, criteria, why and summary in the language with code "${lang}".
- summary: 1-2 sentences about what you found in the notes.`;

  type Out = { summary: string; features: Proposal[] };
  let out = null as Out | null;
  let cost = 0;
  let error = "";
  const tools = dir ? ["Read", "Glob", "Grep"] : [];
  for await (const msg of query({
    prompt,
    options: {
      cwd: dir ?? path.dirname(NOTES),
      model: "sonnet",
      tools,
      allowedTools: tools,
      settingSources: [],
      persistSession: false,
      maxTurns: 30,
      outputFormat: { type: "json_schema", schema: SCHEMA },
    },
  })) {
    if (msg.type === "result") {
      cost = msg.total_cost_usd;
      if (msg.subtype === "success") out = msg.structured_output as Out;
      else error = msg.subtype;
    }
  }
  if (!out) throw httpError(502, `The analysis returned no features (${error || "no output"})`);
  const stamp = now();
  write(NOTES, read<Note>(NOTES).map((n) => (noteIds.includes(n.id) ? { ...n, analyzedAt: stamp } : n)));
  return { project, exists: !!dir, summary: out.summary, proposals: out.features, cost };
}

