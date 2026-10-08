// Mirror dev containers: one container per project (agentos-<project>) that sees projects/ at the SAME absolute path
// as the host, plus shims (python, pip, node, npm, go…) that run those commands inside it. With the shims first on
// PATH, the tab's terminals and the agent's Bash type plain `python` and get the container's: versions pinned by
// the repository, nothing installed on the host, and error paths that still open in the editor.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { httpError, run, userBinPath, writeJson } from "../../../host/server/http.ts";
import { dockerRun } from "./docker.ts";

/** projects/ (mounted read-only) and where the shims live (.state/os/docker/shims). Set once at register. */
let ROOT = "";
let SHIM_ROOT = "";

export function initDevenv(projectsRoot: string, shimRoot: string): void {
  ROOT = projectsRoot;
  SHIM_ROOT = shimRoot;
}

/** A project id ("crm-ws/api") as it goes into container names, labels and paths ("crm-ws--api"). */
const keyOf = (project: string) => project.replace(/\//g, "--");

export type Lang = "python" | "node" | "go";
export type Detected = { lang: Lang; version: string; evidence: string };
export type DevEnvConfig = { lang: Lang; version: string; ports: number[] };
export type DevEnvStatus = {
  container: string; // agentos-<project>
  config: (DevEnvConfig & { image: string; createdAt?: string }) | null; // from <shimDir>/config.json
  state: "running" | "stopped" | "missing" | "unknown"; // unknown: Docker didn't answer, see error
  error?: string;
  detected: Detected[];
  devcontainerWritten?: boolean; // create() only: false when the repo already had its own devcontainer.json
};

const DEFAULTS: Record<Lang, string> = { python: "3.12", node: "22", go: "1.23" };
const IMAGE: Record<Lang, (v: string) => string> = {
  python: (v) => `python:${v}-bookworm`,
  node: (v) => `node:${v}-bookworm`,
  go: (v) => `golang:${v}-bookworm`,
};
const SHIMS: Record<Lang, string[]> = {
  python: ["python", "python3", "pip", "pip3"],
  node: ["node", "npm", "npx", "corepack", "pnpm", "yarn"], // pnpm/yarn come from corepack inside the image
  go: ["go", "gofmt"],
};
const VERSION = /^\d+(\.\d+){0,2}$/;
const PROJECT = /^[\w.-]+$/; // a key: goes into container names, label values and file paths

/** Single-quote escaper for every value written into a generated shell file. */
const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

const validProject = (p: string) => PROJECT.test(keyOf(p)) && !/^\.+$/.test(keyOf(p));
export const containerName = (project: string) => `agentos-${keyOf(project)}`;
export const shimDir = (project: string) => path.join(SHIM_ROOT, keyOf(project));
/** Sourced before each of the agent's Bash commands (CLAUDE_ENV_FILE) and by the tab's terminals. */
export const envFile = (project: string) => path.join(shimDir(project), "env.sh");
const configFile = (project: string) => path.join(shimDir(project), "config.json");
const devcontainerFile = (repo: string) => path.join(repo, ".devcontainer", "devcontainer.json");

const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const ver = (raw: string | undefined) => raw?.match(/\d+(\.\d+){0,2}/)?.[0];

/** Versions the repo itself pins, most explicit file first. */
export function detect(repo: string): Detected[] {
  const out = new Map<Lang, Detected>();
  const add = (lang: Lang, v: string | undefined, evidence: string) => {
    if (v && !out.has(lang)) out.set(lang, { lang, version: lang === "node" ? v.split(".")[0] : v.split(".").slice(0, 2).join("."), evidence });
  };
  for (const line of read(path.join(repo, ".tool-versions")).split("\n")) {
    const [tool, v] = line.trim().split(/\s+/);
    if (tool === "python") add("python", ver(v), ".tool-versions");
    if (tool === "nodejs" || tool === "node") add("node", ver(v), ".tool-versions");
    if (tool === "golang" || tool === "go") add("go", ver(v), ".tool-versions");
  }
  add("python", ver(read(path.join(repo, ".python-version"))), ".python-version");
  add("python", ver(read(path.join(repo, "runtime.txt"))), "runtime.txt");
  add("python", ver(/requires-python\s*=\s*"[^"\d]*([\d.]+)/.exec(read(path.join(repo, "pyproject.toml")))?.[1]), "pyproject.toml");
  add("node", ver(read(path.join(repo, ".nvmrc"))), ".nvmrc");
  add("node", ver(read(path.join(repo, ".node-version"))), ".node-version");
  try {
    add("node", ver(JSON.parse(read(path.join(repo, "package.json")) || "{}").engines?.node), "package.json engines");
  } catch {}
  add("go", ver(/^go\s+([\d.]+)/m.exec(read(path.join(repo, "go.mod")))?.[1]), "go.mod");
  // Manifests without a pinned version still say which language it is.
  if (existsSync(path.join(repo, "requirements.txt")) || existsSync(path.join(repo, "pyproject.toml"))) add("python", DEFAULTS.python, "requirements/pyproject (no pinned version)");
  if (existsSync(path.join(repo, "package.json"))) add("node", DEFAULTS.node, "package.json (no engines)");
  if (existsSync(path.join(repo, "go.mod"))) add("go", DEFAULTS.go, "go.mod");
  return [...out.values()];
}

function readConfig(project: string): DevEnvStatus["config"] {
  try {
    const c = JSON.parse(read(configFile(project)));
    return Object.hasOwn(SHIMS, c?.lang) ? c : null;
  } catch {
    return null;
  }
}

export async function status(project: string, repo: string): Promise<DevEnvStatus> {
  const container = containerName(project);
  const base = { container, config: readConfig(project), detected: detect(repo) };
  try {
    const running = (await dockerRun(["inspect", "-f", "{{.State.Running}}", container], 8000)).trim();
    return { ...base, state: running === "true" ? "running" : "stopped" };
  } catch (e) {
    const msg = (e as Error).message;
    // Only a definite "not found" means missing; a dead daemon or a timeout must not look like a deleted container.
    return /No such (object|container)/i.test(msg) ? { ...base, state: "missing" } : { ...base, state: "unknown", error: msg };
  }
}

/** True when the project has a dev container: terminals and the agent then get the shims. */
export const hasDevEnv = (project: string) => existsSync(envFile(project));

/** Never overwrites: a repo that already has a devcontainer.json keeps its own. Returns whether it wrote one. */
function writeDevcontainer(project: string, repo: string, cfg: DevEnvConfig, image: string) {
  const file = devcontainerFile(repo);
  if (existsSync(file)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  const doc = {
    name: project,
    image,
    // Mirror mount: same path inside and out (VS Code Dev Containers reads these too).
    workspaceMount: "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
    workspaceFolder: "${localWorkspaceFolder}",
    forwardPorts: cfg.ports,
    customizations: { "agent-os-nexo": { lang: cfg.lang, version: cfg.version, shims: SHIMS[cfg.lang] } },
  };
  writeJson(file, doc);
  return true;
}

/** Same lookup the shell would do, but over the user bin dirs so it works without the user's profile. */
const dockerBin = () => userBinPath().map((d) => path.join(d, "docker")).find((f) => existsSync(f)) ?? "docker";

function writeShims(project: string, lang: Lang) {
  const dir = shimDir(project);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const c = containerName(project);
  const head = (what: string) => `#!/bin/sh
# agent-os-nexo shim: ${what} inside the project's dev container, where projects/ is mounted at the same path.
C=${shq(c)}; ROOT=${shq(ROOT)}; D=${shq(dockerBin())}
export DOCKER_CLI_HINTS=false
case "$PWD/" in "$ROOT"/*) W=$PWD ;; *) W=$ROOT ;; esac
[ "$("$D" inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" = true ] || "$D" start "$C" >/dev/null 2>&1 || { echo "agent-os-nexo: could not start the container $C. Is Docker running? If you removed it, create it again from the tab's Terminal view." >&2; exit 125; }
if [ -t 0 ] && [ -t 1 ]; then T=-it; else T=-i; fi
`;
  const write = (name: string, body: string) => {
    writeFileSync(path.join(dir, name), body);
    chmodSync(path.join(dir, name), 0o755);
  };
  for (const cmd of SHIMS[lang]) write(cmd, `${head(`runs \`${cmd}\``)}exec "$D" exec $T -w "$W" -e TERM "$C" ${cmd} "$@"\n`);
  // ctr <cmd…>: anything else in the container (apt-get, pytest, make…); bare `ctr` opens a shell there.
  write("ctr", `${head("runs any command")}[ $# -gt 0 ] || set -- sh -c 'command -v bash >/dev/null && exec bash -l || exec sh -l'\nexec "$D" exec $T -w "$W" -e TERM "$C" "$@"\n`);
  writeFileSync(envFile(project), `# agent-os-nexo: the dev container's ${SHIMS[lang].join(", ")} come first on PATH.\nexport PATH=${shq(dir)}":$PATH"\nexport AGENT_OS_CONTAINER=${shq(c)}\n`);
  // rcfile for the tab's host terminals: the same startup files `bash -l` reads (other tabs use a login shell),
  // then the shims win on PATH.
  const login = "if [ -f ~/.bash_profile ]; then . ~/.bash_profile; elif [ -f ~/.bash_login ]; then . ~/.bash_login; elif [ -f ~/.profile ]; then . ~/.profile; fi";
  writeFileSync(path.join(dir, "bashrc"), `${login}\n. ${shq(envFile(project))}\nPS1="\\[\\e[36m\\]("${shq(c)}")\\[\\e[0m\\] $PS1"\n`);
}

/** Drops the shims and config, so terminals stop pointing at a container that is gone. */
export function forgetShims(project: string) {
  if (validProject(project)) rmSync(shimDir(project), { recursive: true, force: true });
}

/** projects/ is read-only; only this repo and its worktrees are writable, so a dependency's install script in one
 * project can't write git hooks or code into a sibling project. Later mounts override the parent one. */
async function writablePaths(repo: string) {
  const root = realpathSync(ROOT) + path.sep;
  const realRepo = realpathSync(repo);
  const out = await run("git", ["-C", repo, "worktree", "list", "--porcelain"]).then((r) => r.stdout, () => "");
  const trees = out.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length));
  // Trust a worktree only if it really lives under projects/ and its .git file points back into this repo's .git
  // (the list comes from files inside the repo); ':' and ',' would be parsed by `-v`.
  const isOurs = (p: string) => {
    try {
      const real = realpathSync(p);
      if (!real.startsWith(root) || /[:,]/.test(real)) return false;
      return real === realRepo || readFileSync(path.join(real, ".git"), "utf8").trim().startsWith(`gitdir: ${realRepo}/.git/worktrees/`);
    } catch {
      return false;
    }
  };
  return [...new Set([realRepo, ...trees])].filter(isOurs).map((p) => realpathSync(p));
}

/** Each writable tree's .git (the repo's dir, a worktree's pointer file) stays read-only: a hook or config written
 * from inside the container would run on the host at the next `git commit`. Git is used from the host anyway. */
const readOnlyGit = (trees: string[]) => trees.map((t) => path.join(t, ".git")).filter((g) => existsSync(g));

const creating = new Map<string, Promise<DevEnvStatus>>();

/** (Re)creates the container, then writes the shims and config. Pulling the image can take minutes. */
export async function create(project: string, repo: string, cfg: DevEnvConfig) {
  if (creating.has(project)) throw httpError(409, "This project's container is already being created");
  const p = doCreate(project, repo, cfg).finally(() => creating.delete(project));
  creating.set(project, p);
  return p;
}

async function doCreate(project: string, repo: string, cfg: DevEnvConfig): Promise<DevEnvStatus> {
  if (!validProject(project)) throw httpError(400, `Project name not supported for containers: ${project}`);
  const lang = String(cfg.lang);
  if (!Object.hasOwn(SHIMS, lang)) throw httpError(400, `Unsupported language: ${lang}`);
  if (!VERSION.test(cfg.version)) throw httpError(400, `Invalid version: ${cfg.version}`);
  const ports = [...new Set((cfg.ports ?? []).map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536))];
  const image = IMAGE[lang as Lang](cfg.version);
  const name = containerName(project);
  const rw = await writablePaths(repo);
  // Pull first: if it fails, the working container is still there.
  await dockerRun(["pull", "--quiet", image], 15 * 60_000);
  await dockerRun(["rm", "-f", name], 30_000).catch((e) => {
    if (!/No such container/i.test(e.message)) throw e;
  });
  try {
    await dockerRun([
      "run", "-d", "--init", "--name", name,
      "--label", `agent-os-nexo.project=${project}`, "--label", `agent-os-nexo.repo=${repo}`,
      "-e", "PIP_ROOT_USER_ACTION=ignore", "-e", "PIP_DISABLE_PIP_VERSION_CHECK=1",
      "-e", "HUSKY=0", // .git is read-only in here, so husky's install step must not try to write hooks
      "-v", `${ROOT}:${ROOT}:ro`, ...rw.flatMap((p) => ["-v", `${p}:${p}`]),
      ...readOnlyGit(rw).flatMap((g) => ["-v", `${g}:${g}:ro`]), "-w", repo,
      ...ports.flatMap((p) => ["-p", `127.0.0.1:${p}:${p}`]),
      image, "sleep", "infinity",
    ], 120_000);
  } catch (e) {
    forgetShims(project); // the old container is gone, so its shims would point at nothing
    throw e;
  }
  writeShims(project, lang as Lang);
  writeJson(configFile(project), { lang, version: cfg.version, ports, image, createdAt: new Date().toISOString() });
  const devcontainerWritten = writeDevcontainer(project, repo, { lang: lang as Lang, version: cfg.version, ports }, image);
  return { ...(await status(project, repo)), devcontainerWritten };
}

export async function remove(project: string) {
  if (!validProject(project)) throw httpError(400, `Project name not supported for containers: ${project}`);
  await dockerRun(["rm", "-f", containerName(project)], 30_000).catch((e) => {
    if (!/No such container/i.test(e.message)) throw e;
  });
  forgetShims(project);
}

/** The usual "install the deps" command for the language, run inside the container. */
export function installCommand(repo: string, lang: Lang): string | null {
  const has = (f: string) => existsSync(path.join(repo, f));
  if (lang === "python") return has("requirements.txt") ? "pip install -r requirements.txt" : has("pyproject.toml") ? "pip install -e ." : null;
  if (lang === "node") return has("pnpm-lock.yaml") ? "corepack enable && pnpm install" : has("yarn.lock") ? "corepack enable && yarn install" : has("package.json") ? "npm install" : null;
  if (lang === "go") return has("go.mod") ? "go mod download" : null;
  return null;
}

/** The agent's system-prompt note when the project runs in a container ("" otherwise). */
export function promptNote(project: string) {
  const cfg = hasDevEnv(project) ? readConfig(project) : null;
  if (!cfg) return "";
  return `This project runs in a dev container (${containerName(project)}): ${SHIMS[cfg.lang].join(", ")} on PATH are shims that execute inside it at the same paths, so use them normally and never install on the host; any other tool goes through \`ctr\` (e.g. \`ctr pytest\`), including inline env vars (\`ctr env FOO=1 python x.py\`). Long-running dev servers must bind 0.0.0.0 to be reachable on the published ports (${cfg.ports.join(", ") || "none"}); host services are at host.docker.internal. An interrupted command may keep running in the container (\`ctr pkill -f <x>\`).`;
}
