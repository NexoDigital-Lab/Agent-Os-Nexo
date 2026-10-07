// Create, clone and delete projects. The project skeleton (AGENTS.md, context/, secrets/, AI files) comes from
// the nexo CLI, so a project made here is the same as one made in the terminal; this adds what the UI offers
// on top: a first commit, a GitHub repository, and a delete that goes to the trash and checks what would be lost.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Env } from "../../../host/server/env.ts";
import { findBin, httpError, run, trash } from "../../../host/server/http.ts";
import { projectHooks, type DeleteFacts, type DeleteOptions } from "./hooks.ts";
import { projectDir, projectPath, readProject, projectIds } from "./projects.ts";

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const FULL = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

const GITIGNORE = `node_modules/
dist/
build/
.env
.env.*
!.env.example
.DS_Store
*.log
.idea/
`;

const errText = (e: unknown) => {
  const err = e as { stderr?: string; message?: string };
  return String(err.stderr || err.message || e).trim();
};

/** Characters cmd.exe acts on inside arguments: a value carrying one must never reach it. */
const CMD_META = /[&|<>^%!"\r\n]/;

/**
 * npm's Windows shim (`nexo.cmd`) only runs `node "%dp0%\…\bin.js" %*`: read that script path out of it, so the CLI
 * runs with node directly and no argument ever goes through cmd.exe. Null when the shim is not npm's.
 */
export function shimScript(cmdFile: string, read: (f: string) => string = (f) => readFileSync(f, "utf8")): string | null {
  let text: string;
  try {
    text = read(cmdFile);
  } catch {
    return null;
  }
  const m = /"%(?:~dp0|dp0)%?\\([^"]+\.(?:c|m)?js)"/i.exec(text);
  return m?.[1] ? join(dirname(cmdFile), m[1]) : null;
}

/** How to run the CLI: a checkout (NEXO_CLI), the shim's script with node, or the binary on PATH. */
export function nexoCommand(platform = process.platform, find: typeof findBin = findBin, script = shimScript): { cmd: string; pre: string[]; viaCmd: boolean } | null {
  const dev = process.env.NEXO_CLI;
  if (dev) return { cmd: process.execPath, pre: [dev], viaCmd: false };
  const bin = platform === "win32" ? find("nexo.cmd") ?? find("nexo") : find("nexo");
  if (!bin) return null;
  if (!/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, pre: [], viaCmd: false };
  const js = script(bin);
  if (js) return { cmd: process.execPath, pre: [js], viaCmd: false };
  return { cmd: process.env.ComSpec ?? "cmd.exe", pre: ["/c", bin], viaCmd: true };
}

/**
 * Runs the nexo CLI against this environment. NEXO_CLI points at a checkout (`…/packages/cli/src/bin.ts`)
 * during development; otherwise `nexo` must be on PATH (it is, when Nexo was installed with npm -g). On Windows the
 * global install is a `.cmd` shim: its script runs with node directly (nexoCommand); only an unknown shim falls back
 * to cmd.exe, and then no argument may carry a character cmd.exe would interpret.
 */
export async function nexo(env: Env, args: string[]): Promise<string> {
  const how = nexoCommand();
  if (!how) throw httpError(500, "The nexo CLI was not found. Install it with: npm install -g @nexodigital/nexo");
  if (how.viaCmd && args.some((a) => CMD_META.test(a))) {
    throw httpError(400, "That text has characters the Windows command line would run (& | < > ^ % ! \"). Remove them, or reinstall nexo with npm.");
  }
  // --root is an option, so it goes before a `--` (after which everything is a positional, e.g. a dictionary term).
  const sep = args.indexOf("--");
  const full = sep < 0 ? [...args, "--root", env.root] : [...args.slice(0, sep), "--root", env.root, ...args.slice(sep)];
  try {
    return (await run(how.cmd, [...how.pre, ...full], { maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
  } catch (e) {
    throw httpError(500, `nexo ${args[0]} failed: ${errText(e)}`);
  }
}

export interface NewProject {
  name: string;
  /** Put it in <ws>-ws/ as a part of that workspace. */
  ws?: string;
  description: string;
  visibility: "private" | "public";
  /** Also create the repository on GitHub and push. */
  remote: boolean;
}

const idOf = (name: string, ws?: string) => (ws ? `${ws}-ws/${name}` : name);

export async function createProject(env: Env, input: NewProject) {
  const name = String(input.name ?? "").trim();
  const ws = input.ws ? String(input.ws).trim() : undefined;
  const description = String(input.description ?? "").trim().slice(0, 350);
  if (!NAME.test(name) || (ws && !NAME.test(ws))) throw httpError(400, "Invalid name: lowercase letters, digits, . _ - (no spaces)");
  const id = idOf(name, ws);
  if (projectIds().includes(id) || existsSync(join(env.projects, id))) throw httpError(409, `projects/${id} already exists`);
  // Fail before touching disk if the GitHub repo name is taken.
  if (input.remote && (await run("gh", ["repo", "view", name, "--json", "name"]).then(() => true, () => false))) {
    throw httpError(409, `You already have a "${name}" repository on GitHub`);
  }

  const steps: string[] = [];
  await nexo(env, ["new", name, ...(ws ? ["--ws", ws] : [])]);
  steps.push(`projects/${id}: AGENTS.md, context/, secrets/ and code/ (git init)`);
  const code = join(env.projects, id, "code");
  const sh = async (cmd: string, args: string[]) => {
    try {
      return (await run(cmd, args, { cwd: code })).stdout.trim();
    } catch (e) {
      throw httpError(500, `${cmd} ${args[0]} failed: ${errText(e)}`, { steps });
    }
  };
  writeFileSync(join(code, "README.md"), `# ${name}\n\n${description || "_Description pending._"}\n`);
  writeFileSync(join(code, ".gitignore"), GITIGNORE);
  await sh("git", ["checkout", "-q", "-b", "main"]).catch(() => "");
  await sh("git", ["add", "-A"]);
  await sh("git", ["commit", "-q", "-m", "Initial commit"]); // the user's git identity, like every other commit
  steps.push("code/: README, .gitignore and the first commit");

  let url: string | null = null;
  if (input.remote) {
    const args = ["repo", "create", name, input.visibility === "public" ? "--public" : "--private", "--source", ".", "--remote", "origin", "--push"];
    if (description) args.push("--description", description);
    const out = await sh("gh", args);
    url = out.split("\n").find((l) => l.startsWith("https://")) ?? (await sh("gh", ["repo", "view", "--json", "url", "-q", ".url"]));
    steps.push(`GitHub: ${input.visibility} repository created and main pushed`);
  }
  return { id, url, steps };
}

export interface RemoteRepo {
  name: string;
  full: string;
  description: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  pushedAt: string;
  /** Already a project here (by repository name). */
  cloned: boolean;
}

export async function listRemoteRepos(): Promise<RemoteRepo[]> {
  const fields = "name,nameWithOwner,description,isPrivate,isFork,isArchived,pushedAt";
  let out: string;
  try {
    out = (await run("gh", ["repo", "list", "--limit", "300", "--json", fields], { maxBuffer: 10 * 1024 * 1024 })).stdout;
  } catch (e) {
    throw httpError(502, `gh repo list failed: ${errText(e)}`);
  }
  const names = new Set(projectIds().map((id) => id.split("/").pop()!));
  type Row = { name: string; nameWithOwner: string; description: string | null; isPrivate: boolean; isFork: boolean; isArchived: boolean; pushedAt: string };
  return (JSON.parse(out) as Row[])
    .map((r) => ({
      name: r.name,
      full: r.nameWithOwner,
      description: r.description ?? "",
      private: r.isPrivate,
      fork: r.isFork,
      archived: r.isArchived,
      pushedAt: r.pushedAt,
      cloned: names.has(r.name.toLowerCase()),
    }))
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
}

export async function cloneProject(env: Env, input: { repo: string; ws?: string; name?: string }) {
  const full = String(input.repo ?? "").trim();
  if (!FULL.test(full) || full.endsWith(".git")) throw httpError(400, "Invalid repository (owner/name)");
  const name = (input.name ? String(input.name) : full.split("/")[1]!).toLowerCase();
  const ws = input.ws ? String(input.ws).trim() : undefined;
  if (!NAME.test(name) || (ws && !NAME.test(ws))) throw httpError(400, "Invalid name: lowercase letters, digits, . _ - (no spaces)");
  const id = idOf(name, ws);
  if (existsSync(join(env.projects, id))) throw httpError(409, `projects/${id} already exists`);
  // gh resolves the URL the user's git credentials work with (https + gh's helper, or ssh).
  const url = await run("gh", ["repo", "view", full, "--json", "url", "-q", ".url"]).then((r) => `${r.stdout.trim()}.git`, () => `https://github.com/${full}.git`);
  await nexo(env, ["clone", url, "--name", name, ...(ws ? ["--ws", ws] : [])]);
  const code = join(env.projects, id, "code");
  const branch = await run("git", ["branch", "--show-current"], { cwd: code }).then((r) => r.stdout.trim(), () => "?");
  return { id, url: `https://github.com/${full}`, steps: [`projects/${id}/code: cloned from ${full} (${branch})`] };
}

const out = (cmd: string, args: string[], cwd?: string) => run(cmd, args, { cwd }).then((r) => r.stdout.trim(), () => null);

function countFiles(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  return n;
}

export interface DeleteCheck extends Required<DeleteFacts> {
  id: string;
  /** Uncommitted files. */
  dirty: number;
  /** Commits not on the upstream; null = no upstream to compare with. */
  unpushed: number | null;
  stashes: number;
  /** owner/name on GitHub. */
  remote: string | null;
  remoteIsMine: boolean;
  /** The gh token has delete_repo. */
  canDeleteRemote: boolean;
  worktrees: string[];
  /** Files outside code/ (context, secrets…). */
  contextFiles: number;
}

async function known(id: string) {
  const p = await readProject(id);
  if (!p) throw httpError(404, `Unknown project: ${id}`);
  return p;
}

export async function deleteCheck(id: string): Promise<DeleteCheck> {
  const p = await known(id);
  const code = p.path;
  const [status, ahead, stash, origin, me, auth] = await Promise.all([
    code ? out("git", ["status", "--porcelain"], code) : null,
    code ? out("git", ["rev-list", "--count", "@{upstream}..HEAD"], code) : null,
    code ? out("git", ["stash", "list"], code) : null,
    code ? out("git", ["remote", "get-url", "origin"], code) : null,
    out("gh", ["api", "user", "-q", ".login"]),
    run("gh", ["auth", "status"]).then((r) => r.stdout + r.stderr, (e: { stdout?: string; stderr?: string }) => String(e.stdout ?? "") + String(e.stderr ?? "")),
  ]);
  const facts: DeleteFacts = {};
  for (const h of projectHooks()) Object.assign(facts, await h.deleteFacts?.(p));
  // git@github.com:o/n.git | https://github.com/o/n(.git)
  const remote = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(origin ?? "")?.[1] ?? null;
  const all = countFiles(p.dir);
  return {
    id,
    dirty: status ? status.split("\n").filter(Boolean).length : 0,
    unpushed: ahead === null ? null : Number(ahead),
    stashes: stash ? stash.split("\n").filter(Boolean).length : 0,
    remote,
    remoteIsMine: !!remote && !!me && remote.split("/")[0]!.toLowerCase() === me.toLowerCase(),
    canDeleteRemote: /delete_repo/.test(auth),
    worktrees: p.worktrees.map((w) => w.name),
    contextFiles: all - (code ? countFiles(code) : 0),
    runningTabs: facts.runningTabs ?? 0,
    openTabs: facts.openTabs ?? 0,
    container: facts.container ?? null,
  };
}

export async function deleteProject(id: string, body: Partial<DeleteOptions> & { confirm?: string }) {
  const p = await known(id);
  const opts: DeleteOptions = { code: !!body.code, folder: !!body.folder, remote: !!body.remote, container: !!body.container };
  if (body.confirm !== p.name) throw httpError(400, "Type the project's exact name to confirm");
  if (!opts.code && !opts.folder && !opts.remote) throw httpError(400, "Nothing was selected to delete");
  const c = await deleteCheck(id);
  if (c.runningTabs) throw httpError(409, `${c.runningTabs} tab(s) of ${id} are working. Stop them before deleting.`);
  const local = opts.folder || opts.code;
  if (local && c.worktrees.length) throw httpError(409, `It has worktrees (${c.worktrees.join(", ")}): delete them first, or they break.`);

  const steps: string[] = [];
  // Remote first: if GitHub refuses, nothing local has been touched yet.
  if (opts.remote) {
    if (!c.remote) throw httpError(400, "The project has no GitHub repository as origin");
    if (!c.remoteIsMine) throw httpError(403, `${c.remote} is not in your account: it can't be deleted from here`);
    if (!c.canDeleteRemote) throw httpError(403, "Your gh token lacks the delete_repo scope. Run: gh auth refresh -h github.com -s delete_repo");
    try {
      await run("gh", ["repo", "delete", c.remote, "--yes"]);
    } catch (e) {
      throw httpError(500, `gh repo delete failed: ${errText(e)}`);
    }
    steps.push(`GitHub: ${c.remote} deleted`);
  }
  if (local) {
    for (const h of projectHooks()) await h.beforeLocalDelete?.(p);
    if (opts.folder) {
      await trash(p.dir, `projects/${id}`);
      steps.push(`projects/${id} → trash`);
    } else if (p.path) {
      await trash(p.path, `projects/${id}/code`);
      steps.push(`projects/${id}/code → trash`);
    }
    for (const h of projectHooks()) await h.afterLocalDelete?.(p, opts, steps);
  }
  return { steps, gone: opts.folder };
}

export { projectDir, projectPath };
