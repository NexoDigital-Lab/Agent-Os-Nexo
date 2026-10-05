// Extensions per project: one catalog of VS Code extensions (installable with `code`), some with an equivalent
// that runs inside agent-os's own editor. General ones apply to every project (library/extensions.json); each
// project's list lives in its context/extensions.json and is mirrored to code/.vscode/extensions.json on request.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Env } from "../../../host/server/env.ts";
import { httpError, readJson, run } from "../../../host/server/http.ts";
import { projectDir, projectIds, projectPath } from "../../projects/server/projects.ts";
import { detectStacks, type Stack } from "../../projects/server/stacks.ts";
import { installed } from "../../projects/server/vscode.ts";
import { userLanguage } from "../../sessions/server/skills.ts";
import { byId, CATALOG, isEditorOnly, VSCODE_ID, type EditorPlugin } from "./catalog.ts";

// ---------- storage ----------
let GENERAL_FILE = "";

export function initExtensions(env: Env): void {
  GENERAL_FILE = path.join(env.library, "extensions.json");
}
const DEFAULT_GENERAL = ["pkief.material-icon-theme", "esbenp.prettier-vscode", "usernamehw.errorlens", "agent-os.brackets", "agent-os.emmet"];

type AiRec = { id: string; name: string; why: string };
type ProjectFile = { extensions: string[]; dismissed: string[]; ai: AiRec[]; aiAt?: string; aiCost?: number };

/** .vscode/*.json is JSONC: drop comments and trailing commas before parsing. */
const parseJsonc = (text: string) => JSON.parse(text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));

const readGeneral = (): string[] => readJson(GENERAL_FILE, { general: DEFAULT_GENERAL }).general;
const projFile = (p: string) => path.join(projectDir(p) ?? "", "context", "extensions.json");
const repoOf = (p: string) => {
  const repo = projectPath(p);
  if (!repo) throw httpError(404, `Unknown project or no code/ yet: ${p}`);
  return repo;
};
const vscodeFile = (p: string) => path.join(repoOf(p), ".vscode", "extensions.json");

function readProject(p: string): ProjectFile {
  const empty: ProjectFile = { extensions: [], dismissed: [], ai: [] };
  if (existsSync(projFile(p))) return readJson(projFile(p), empty);
  // First look: adopt whatever the repo already recommends to VS Code.
  try {
    const recs: string[] = parseJsonc(readFileSync(vscodeFile(p), "utf8")).recommendations ?? [];
    const general = new Set(readGeneral().map((g) => g.toLowerCase()));
    return { ...empty, extensions: recs.filter((r) => VSCODE_ID.test(r) && !general.has(r.toLowerCase())) };
  } catch {
    return empty;
  }
}

/** What .vscode/extensions.json should recommend: general + project VS Code ids. */
const wantedVscode = (data: ProjectFile) => [...new Set([...readGeneral(), ...data.extensions].filter((id) => !isEditorOnly(id)))];

/** Current recommendations in the repo's file; null = no file, "invalid" = can't parse. */
function currentVscode(p: string): string[] | null | "invalid" {
  if (!existsSync(vscodeFile(p))) return null;
  try {
    return parseJsonc(readFileSync(vscodeFile(p), "utf8")).recommendations ?? [];
  } catch {
    return "invalid";
  }
}

/** Mirrors the wanted ids into the repo's .vscode/extensions.json, keeping its other keys. */
function writeVscode(p: string, data: ProjectFile): string | null {
  const file = vscodeFile(p);
  let base: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      base = parseJsonc(readFileSync(file, "utf8"));
    } catch {
      return ".vscode/extensions.json could not be read (invalid JSON); it was left alone";
    }
  }
  const ids = wantedVscode(data);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...base, recommendations: ids }, null, 2) + "\n");
  return null;
}

/** Only context/extensions.json: the repo's .vscode changes only when you press Sync. */
function saveProject(p: string, data: ProjectFile) {
  mkdirSync(path.dirname(projFile(p)), { recursive: true });
  writeFileSync(projFile(p), JSON.stringify(data, null, 2) + "\n");
}

// ---------- views ----------
export type Rec = { id: string; name: string; why: string; source: "rules" | "ai" };
export type ProjectExt = {
  name: string;
  stacks: Stack[];
  extensions: string[];
  recommended: Rec[];
  dismissed: string[];
  custom: AiRec[]; // names/reasons for ids that aren't in the catalog
  editor: EditorPlugin[]; // plugins the agent-os editor turns on for this project
  managed: boolean; // has its own context/extensions.json
  vscode: { exists: boolean; ignored: boolean; inSync: boolean; invalid: boolean };
  aiAt?: string;
  aiCost?: number;
};

async function projectView(p: string): Promise<ProjectExt> {
  const repo = repoOf(p);
  const data = readProject(p);
  const stacks = await detectStacks(repo);
  const general = readGeneral();
  const taken = new Set([...general, ...data.extensions, ...data.dismissed].map((x) => x.toLowerCase()));
  const recommended: Rec[] = [];
  for (const e of CATALOG) {
    const hit = stacks.find((s) => e.stacks?.includes(s.key));
    if (hit && !taken.has(e.id.toLowerCase())) recommended.push({ id: e.id, name: e.name, why: `found ${hit.evidence}`, source: "rules" });
  }
  for (const r of data.ai) {
    if (taken.has(r.id.toLowerCase()) || recommended.some((x) => x.id.toLowerCase() === r.id.toLowerCase())) continue;
    recommended.push({ ...r, source: "ai" });
  }
  const editor = [...general, ...data.extensions].map((id) => byId.get(id.toLowerCase())?.editor).filter((e): e is EditorPlugin => !!e);
  const ignored = await run("git", ["check-ignore", "-q", ".vscode/extensions.json"], { cwd: repo }).then(() => true, () => false);
  return {
    name: p,
    stacks,
    extensions: data.extensions,
    recommended,
    dismissed: data.dismissed,
    custom: data.ai.filter((r) => !byId.has(r.id.toLowerCase())),
    editor: [...new Set(editor)],
    managed: existsSync(projFile(p)),
    vscode: (() => {
      const cur = currentVscode(p);
      const want = wantedVscode(data).map((x) => x.toLowerCase()).sort().join();
      const have = Array.isArray(cur) ? cur.map((x) => x.toLowerCase()).sort().join() : null;
      return { exists: cur !== null, ignored, inSync: have === want, invalid: cur === "invalid" };
    })(),
    aiAt: data.aiAt,
    aiCost: data.aiCost,
  };
}

export async function overview() {
  const names = projectIds().filter((id) => projectPath(id)).sort((a, b) => a.localeCompare(b));
  const [ids, projects] = await Promise.all([installed(), Promise.all(names.map(projectView))]);
  return { catalog: CATALOG, general: readGeneral(), installed: ids ? [...ids] : null, projects };
}

export const projectExtensions = (p: string) => projectView(p);

export async function saveProjectExtensions(p: string, body: { extensions?: unknown; dismissed?: unknown }) {
  repoOf(p);
  const clean = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((id) => VSCODE_ID.test(id)))];
  const data = readProject(p);
  saveProject(p, { ...data, extensions: clean(body.extensions), dismissed: clean(body.dismissed) });
  return projectView(p);
}

/** Only library/extensions.json: each repo's .vscode shows as out of sync until you sync that project. */
export function saveGeneral(general: unknown) {
  const ids = [...new Set((Array.isArray(general) ? general : []).map(String).filter((id) => VSCODE_ID.test(id)))];
  writeFileSync(GENERAL_FILE, JSON.stringify({ general: ids }, null, 2) + "\n");
  return { general: ids };
}

/** The "Sync .vscode" button: writes the project's current list to its repo. */
export async function syncVscode(p: string) {
  repoOf(p);
  const warning = writeVscode(p, readProject(p));
  if (warning) throw httpError(409, warning);
  return projectView(p);
}

// ---------- AI recommendations ----------
const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, why: { type: "string" } },
        required: ["id", "name", "why"],
      },
    },
  },
  required: ["summary", "recommendations"],
};

export async function recommendWithClaude(p: string) {
  const repo = repoOf(p);
  const view = await projectView(p);
  const general = readGeneral();
  const have = await installed();
  const lang = userLanguage();
  const prompt = `Recommend VS Code extensions for the project "${p}" (repository: ${repo}). Look at the code with Read/Glob/Grep (manifests, structure, frameworks, tests, infra) before deciding.

Stack detected by rules: ${view.stacks.map((s) => `${s.key} (${s.evidence})`).join(", ") || "none"}.
Already applied to EVERY project (do not repeat them): ${general.join(", ")}.
Already chosen for this project (do not repeat them): ${view.extensions.join(", ") || "none"}.
Dismissed by the user (do not repeat them): ${view.dismissed.join(", ") || "none"}.
Known catalog (prefer these when they fit): ${CATALOG.filter((e) => !isEditorOnly(e.id)).map((e) => `${e.id} = ${e.name}`).join("; ")}.
${have ? `Installed in their VS Code: ${[...have].join(", ")}.` : ""}

Rules:
- Between 3 and 8 recommendations, only the ones that truly help in THIS repository. Few and precise is better.
- id = the REAL Marketplace identifier (publisher.name). If you are not sure it exists, leave it out.
- why: one concrete line citing what you saw in the repository (file, dependency, pattern), in the language with code "${lang}".
- summary: one sentence about what kind of project it is, in the same language.`;

  let out = null as { summary: string; recommendations: AiRec[] } | null;
  let cost = 0;
  let error = "";
  for await (const msg of query({
    prompt,
    options: {
      cwd: repo,
      model: "haiku",
      tools: ["Read", "Glob", "Grep"],
      allowedTools: ["Read", "Glob", "Grep"],
      settingSources: [],
      persistSession: false,
      maxTurns: 15,
      outputFormat: { type: "json_schema", schema: SCHEMA },
    },
  })) {
    if (msg.type === "result") {
      cost = msg.total_cost_usd;
      if (msg.subtype === "success") out = msg.structured_output as typeof out;
      else error = msg.subtype;
    }
  }
  if (!out) throw httpError(502, `The AI returned no recommendations (${error || "no output"})`);
  const ai = out.recommendations
    .filter((r) => VSCODE_ID.test(r.id) && !isEditorOnly(r.id))
    .map((r) => ({ id: byId.get(r.id.toLowerCase())?.id ?? r.id, name: String(r.name).slice(0, 80), why: String(r.why).slice(0, 300) }));
  const data = readProject(p);
  mkdirSync(path.dirname(projFile(p)), { recursive: true });
  writeFileSync(projFile(p), JSON.stringify({ ...data, ai, aiAt: new Date().toISOString(), aiCost: cost }, null, 2) + "\n");
  return { ...(await projectView(p)), summary: out.summary, cost };
}

export type ExtOverview = Awaited<ReturnType<typeof overview>>;
