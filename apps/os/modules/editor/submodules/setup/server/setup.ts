// 🧙 Project setup, on top of the recipes in recipes.ts. `analyze` looks at the repo and returns only the questions that apply; `buildPlan` turns the answers into files
// to write + one shell chain to run in a visible terminal. Preview and apply share `buildPlan`, so what you
// approve is exactly what runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { httpError, run } from "../../../../../host/server/http.ts";
import { projectExtensions, saveProjectExtensions, syncVscode } from "../../../../extensions/server/extensions.ts";
import { projectDir } from "../../../../projects/server/projects.ts";
import { repoFiles } from "../../../../projects/server/repo.ts";
import { isEditorOnly, VSCODE_ID } from "../../../../projects/server/vscode.ts";
import { runConfigs, saveRunConfigs, toolchains, type ToolStatus } from "../../../server/runner.ts";
import { RECIPES, type Answers, type Ctx } from "./recipes.ts";

// ---------- analysis ----------
const IGNORABLE = new Set(["README.md", ".gitignore", "LICENSE", "LICENSE.md", ".gitattributes"]);
const ENV_EXAMPLES = [".env.example", ".env.sample", ".env.template", ".env.dist"];

/** The GitHub CLI lookup (a network call), swappable so tests do not depend on it. */
export const deps = { githubLogin: () => run("gh", ["api", "user", "-q", ".login"]).then((r) => r.stdout.trim(), () => "user") };

let ghUser: string | null = null;
const githubUser = async () => (ghUser ??= await deps.githubLogin());

async function context(repo: string): Promise<Ctx> {
  const files = await repoFiles(repo);
  const set = new Set(files);
  return { repo, files, has: (f) => set.has(f) || existsSync(path.join(repo, f)), read: (f) => (existsSync(path.join(repo, f)) ? readFileSync(path.join(repo, f), "utf8") : "") };
}

type EnvKey = { key: string; value: string; comment: string; current: string | null };

function parseEnv(text: string): { key: string; value: string; comment: string }[] {
  const out: { key: string; value: string; comment: string }[] = [];
  let comment = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) comment = t.replace(/^#+\s*/, "");
    else if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(t)) {
      const [k, ...v] = t.split("=");
      out.push({ key: k!.trim(), value: v.join("=").trim().replace(/^["']|["']$/g, ""), comment });
      comment = "";
    } else comment = "";
  }
  return out;
}

export async function analyze(project: string, repo: string) {
  const c = await context(repo);
  const empty = c.files.every((f) => IGNORABLE.has(f));
  const detected = empty ? [] : RECIPES.map((r) => ({ id: r.id, name: r.name, evidence: r.detect(c) })).filter((d): d is { id: string; name: string; evidence: string } => !!d.evidence);
  // Specific stacks win over their generic parents (NestJS over "Node + TypeScript", FastAPI over "Python").
  const primary = detected.filter((d) => !(d.id === "node-ts" && detected.some((x) => ["nest", "next", "react-vite"].includes(x.id))) && !(d.id === "python" && detected.some((x) => x.id === "fastapi")));
  const gh = await githubUser();

  const exampleFile = ENV_EXAMPLES.find((f) => c.has(f)) ?? null;
  const current = new Map(parseEnv(c.read(".env")).map((e) => [e.key, e.value]));
  const env = exampleFile ? parseEnv(c.read(exampleFile)).map((e): EnvKey => ({ ...e, current: current.get(e.key) ?? null })) : [];

  const ext = await projectExtensions(project);
  // nexo-onboard fills the project's AGENTS.md; while its placeholders are there, the AI knows little about it.
  const agents = path.join(projectDir(project) ?? "", "AGENTS.md");
  const contextThin = !existsSync(agents) || readFileSync(agents, "utf8").includes("<!-- filled by nexo-onboard");

  return {
    project,
    empty,
    detected: primary,
    recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, desc: r.desc, questions: r.questions?.(project, gh) ?? [], toolchains: r.toolchains, scaffold: !!r.scaffold, extensions: r.extensions, run: r.run })),
    toolchains: await toolchains(repo),
    deps: primary.flatMap((d) => RECIPES.find((r) => r.id === d.id)!.deps?.(c) ?? []).filter((d, i, all) => all.findIndex((x) => x.cmd === d.cmd) === i),
    env: { file: exampleFile, keys: env, hasEnv: c.has(".env") },
    extensions: { recommended: ext.recommended.filter((r) => r.source === "rules"), current: ext.extensions },
    run: runConfigs(project, repo),
    contextThin,
  };
}

// ---------- plan ----------
export type SetupBody = {
  recipe?: string; // scaffold this recipe (empty repos)
  answers?: Answers;
  toolchains?: string[]; // tool keys to install
  deps?: string[]; // dep commands to run (as returned by analyze)
  env?: Record<string, string>;
  extensions?: string[]; // ids to add to the project's list
  installExtensions?: boolean; // also `code --install-extension`
  writeVscode?: boolean;
  addRun?: boolean; // add the recipe's Run commands
};

export type SetupPlan = { writes: { path: string; what: string }[]; commands: { label: string; cmd: string }[] };

async function buildPlan(project: string, repo: string, b: SetupBody): Promise<SetupPlan & { files: Record<string, string>; gitignore: string[]; runCmds: { label: string; cmd: string }[] }> {
  const recipe = b.recipe ? RECIPES.find((r) => r.id === b.recipe) : undefined;
  if (b.recipe && !recipe) throw httpError(400, `Unknown recipe: ${b.recipe}`);
  const c = await context(repo);
  const writes: SetupPlan["writes"] = [];
  const commands: SetupPlan["commands"] = [];
  const files: Record<string, string> = {};
  const gitignore: string[] = [];

  // 1. toolchains, ordered so a tool's prerequisites come first (gopls needs go)
  const tools = await toolchains(repo);
  const order = ["git", "go", "node", "python", "docker", "gopls"];
  for (const key of [...(b.toolchains ?? [])].sort((x, y) => order.indexOf(x) - order.indexOf(y))) {
    const t = tools.find((x: ToolStatus) => x.key === key);
    if (t && !t.installed && t.install) commands.push({ label: `Install ${t.name}`, cmd: t.install });
  }

  // 2. scaffold
  if (recipe?.scaffold) {
    const s = recipe.scaffold(b.answers ?? {}, project);
    for (const [p, content] of Object.entries(s.files)) {
      if (c.has(p)) continue; // never overwrite
      files[p] = content;
      writes.push({ path: p, what: "template file" });
    }
    for (const cmd of s.commands) if (!(cmd.startsWith("go mod init") && c.has("go.mod"))) commands.push({ label: `Template: ${recipe.name}`, cmd });
    gitignore.push(...(s.gitignore ?? []));
  }

  // 3. dependencies (only commands analyze offered)
  const offered = RECIPES.flatMap((r) => (r.detect(c) ? r.deps?.(c) ?? [] : []));
  for (const cmd of b.deps ?? []) {
    const d = offered.find((x) => x.cmd === cmd);
    if (d && !commands.some((x) => x.cmd === d.cmd)) commands.push(d);
  }

  // 4. .env (merged over the current one; never committed)
  if (b.env && Object.keys(b.env).length) {
    writes.push({ path: ".env", what: `${Object.keys(b.env).length} variable(s)` });
    const ignored = await run("git", ["check-ignore", "-q", ".env"], { cwd: repo }).then(() => true, () => false);
    if (!ignored) gitignore.push(".env");
  }

  // 5. editor
  if (b.extensions?.length) writes.push({ path: "context/extensions.json", what: `${b.extensions.length} extension(s)` });
  if (b.writeVscode) writes.push({ path: ".vscode/extensions.json", what: "recommendations for VS Code" });
  // The id ends up in a shell command: only real Marketplace ids (publisher.name) get through.
  if (b.installExtensions)
    for (const id of b.extensions ?? []) if (VSCODE_ID.test(id) && !isEditorOnly(id)) commands.push({ label: `VS Code: ${id}`, cmd: `code --install-extension ${id}` });
  // Existing repos already get their real scripts detected by ▶ Run; recipe commands are for fresh templates.
  const runCmds = b.addRun && recipe ? recipe.run : [];
  if (runCmds.length) writes.push({ path: "context/run.json", what: `${runCmds.length} ▶ Run command(s)` });

  const existingIgnore = c.read(".gitignore").split("\n").map((l) => l.trim());
  const newIgnore = [...new Set(gitignore)].filter((g) => !existingIgnore.includes(g));
  if (newIgnore.length) writes.push({ path: ".gitignore", what: `adds ${newIgnore.join(", ")}` });

  return { writes, commands, files, gitignore: newIgnore, runCmds };
}

export async function planSetup(project: string, repo: string, b: SetupBody): Promise<SetupPlan> {
  const { writes, commands } = await buildPlan(project, repo, b);
  return { writes, commands };
}

/** Writes the files now; returns the command chain for the terminal (stops at the first failure). */
export async function applySetup(project: string, repo: string, b: SetupBody) {
  const p = await buildPlan(project, repo, b);
  for (const [rel, content] of Object.entries(p.files)) {
    const abs = path.join(repo, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    if (!existsSync(abs)) writeFileSync(abs, content, { flag: "wx" });
  }
  if (p.gitignore.length) {
    const file = path.join(repo, ".gitignore");
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    appendFileSync(file, `${before && !before.endsWith("\n") ? "\n" : ""}${p.gitignore.join("\n")}\n`);
  }
  if (b.env && Object.keys(b.env).length) writeEnv(path.join(repo, ".env"), b.env);
  if (b.extensions?.length) {
    const cur = await projectExtensions(project);
    await saveProjectExtensions(project, { extensions: [...new Set([...cur.extensions, ...b.extensions])], dismissed: cur.dismissed });
  }
  if (b.writeVscode) await syncVscode(project).catch(() => null);
  if (p.runCmds.length) {
    const own = runConfigs(project, repo).filter((r) => r.source === "own");
    saveRunConfigs(project, [...own, ...p.runCmds.filter((r) => !own.some((o) => o.cmd === r.cmd))]);
  }
  // Each step announces itself; `&&` stops the chain at the first failure so nothing runs on a broken base.
  const chain = p.commands.length
    ? [...p.commands.map((c, i) => `printf '\\n\\033[1;33m▶ [${i + 1}/${p.commands.length}] %s\\033[0m\\n' ${shq(c.label)} && ${c.cmd}`), `printf '\\n\\033[1;32m✔ Setup done\\033[0m\\n'`].join(" && ")
    : null;
  return { writes: p.writes, commands: p.commands, chain };
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const envLine = (k: string, v: string) => `${k}=${/[\s#"'$\\]/.test(v) ? JSON.stringify(v) : v}`;

/** Updates values in place (comments, order and other keys survive) and appends keys the file didn't have. */
function writeEnv(file: string, values: Record<string, string>) {
  const pending = new Map(Object.entries(values).filter(([k]) => ENV_KEY.test(k)).map(([k, v]) => [k, String(v).replace(/[\r\n]+/g, " ")]));
  const lines = existsSync(file) ? readFileSync(file, "utf8").replace(/\n$/, "").split("\n") : [];
  const out = lines.map((line) => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !pending.has(m[2]!)) return line;
    const v = pending.get(m[2]!)!;
    pending.delete(m[2]!);
    return m[1] + envLine(m[2]!, v); // keeps an `export ` prefix
  });
  for (const [k, v] of pending) out.push(envLine(k, v));
  writeFileSync(file, out.join("\n") + "\n");
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type SetupAnalysis = Awaited<ReturnType<typeof analyze>>;
