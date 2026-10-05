// ▶ Run and Environment: the commands a project runs with (detected from its manifests + your own, saved in the
// project's context/run.json), and which toolchains it needs vs what this machine has.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Env } from "../../../host/server/env.ts";
import { loginShell, readJson } from "../../../host/server/http.ts";
import { projectDir } from "../../projects/server/projects.ts";
import { detectStacks } from "../../projects/server/stacks.ts";

export type RunCmd = { label: string; cmd: string; source: "detected" | "own" };

const runFile = (p: string) => path.join(projectDir(p) ?? "", "context", "run.json");

let configuredPm: string | null = null;

/** The package manager `nexo analyze` recorded for this machine, if any. */
export function initRunner(env: Env): void {
  configuredPm = readJson<{ system?: { packageManager?: string | null } | null }>(path.join(env.root, "environment.config.json"), {}).system?.packageManager ?? null;
}

function detected(repo: string): RunCmd[] {
  const out: RunCmd[] = [];
  const add = (label: string, cmd: string) => out.push({ label, cmd, source: "detected" });
  if (existsSync(path.join(repo, "go.mod"))) {
    add("go run .", "go run .");
    add("go test ./...", "go test ./...");
    add("go build ./...", "go build ./...");
    add("go vet ./...", "go vet ./...");
  }
  const pkg = readJson<{ scripts?: Record<string, string> } | null>(path.join(repo, "package.json"), null);
  if (pkg?.scripts) {
    const pm = existsSync(path.join(repo, "pnpm-lock.yaml")) ? "pnpm" : existsSync(path.join(repo, "yarn.lock")) ? "yarn" : "npm";
    for (const s of Object.keys(pkg.scripts)) add(`${pm} run ${s}`, `${pm} run ${s}`);
  }
  if (existsSync(path.join(repo, "Makefile"))) {
    const targets = readFileSync(path.join(repo, "Makefile"), "utf8").match(/^[A-Za-z0-9][\w.-]*(?=:(?!=))/gm) ?? [];
    for (const t of [...new Set(targets)].slice(0, 15)) add(`make ${t}`, `make ${t}`);
  }
  if (existsSync(path.join(repo, "manage.py"))) add("django runserver", "python3 manage.py runserver");
  else if (existsSync(path.join(repo, "main.py"))) add("python main.py", "python3 main.py");
  if (existsSync(path.join(repo, "Cargo.toml"))) (add("cargo run", "cargo run"), add("cargo test", "cargo test"));
  if (existsSync(path.join(repo, "docker-compose.yml")) || existsSync(path.join(repo, "compose.yml"))) (add("docker compose up", "docker compose up"), add("docker compose down", "docker compose down"));
  return out;
}

export function runConfigs(p: string, repo: string): RunCmd[] {
  const saved = readJson<{ commands?: Array<{ label?: string; cmd?: string }> } | null>(runFile(p), null)?.commands ?? [];
  const own: RunCmd[] = saved.map((c) => ({ label: String(c.label || c.cmd), cmd: String(c.cmd), source: "own" as const }));
  return [...own, ...detected(repo).filter((d) => !own.some((o) => o.cmd === d.cmd))];
}

export function saveRunConfigs(p: string, commands: unknown) {
  const clean = (Array.isArray(commands) ? commands : [])
    .map((c: { label?: unknown; cmd?: unknown }) => ({ label: String(c?.label ?? "").trim().slice(0, 60), cmd: String(c?.cmd ?? "").trim().slice(0, 500) }))
    .filter((c) => c.cmd)
    .map((c) => ({ label: c.label || c.cmd, cmd: c.cmd }));
  mkdirSync(path.dirname(runFile(p)), { recursive: true });
  writeFileSync(runFile(p), JSON.stringify({ commands: clean }, null, 2) + "\n");
  return clean;
}

// ---------- toolchains ----------
type Tool = { key: string; name: string; bin: string; version: string[]; needs: string[]; install: Record<string, string> };

// needs: the detected stacks that require it ("*" = every project)
const TOOLS: Tool[] = [
  { key: "git", name: "Git", bin: "git", version: ["--version"], needs: ["*"], install: { dnf: "sudo dnf install -y git", apt: "sudo apt install -y git", brew: "brew install git" } },
  { key: "go", name: "Go", bin: "go", version: ["version"], needs: ["go"], install: { dnf: "sudo dnf install -y golang", apt: "sudo apt install -y golang-go", brew: "brew install go" } },
  { key: "gopls", name: "gopls (Go language server)", bin: "gopls", version: ["version"], needs: ["go"], install: { any: "go install golang.org/x/tools/gopls@latest" } },
  { key: "node", name: "Node.js", bin: "node", version: ["--version"], needs: ["javascript", "typescript", "react", "next", "nest", "vue", "astro", "react-native", "expo"], install: { dnf: "sudo dnf install -y nodejs", apt: "sudo apt install -y nodejs npm", brew: "brew install node" } },
  { key: "python", name: "Python 3", bin: "python3", version: ["--version"], needs: ["python"], install: { dnf: "sudo dnf install -y python3 python3-pip", apt: "sudo apt install -y python3 python3-pip", brew: "brew install python" } },
  { key: "docker", name: "Docker", bin: "docker", version: ["--version"], needs: ["docker"], install: { dnf: "sudo dnf install -y docker-cli docker-compose", apt: "sudo apt install -y docker.io docker-compose-v2", brew: "brew install --cask docker" } },
];

let pm: string | null = null;
function packageManager(): string {
  if (pm) return pm;
  if (configuredPm && ["dnf", "apt", "brew"].includes(configuredPm)) return (pm = configuredPm);
  if (process.platform === "darwin") return (pm = "brew");
  const os = existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : "";
  pm = /ID(_LIKE)?=.*(fedora|rhel|centos)/.test(os) ? "dnf" : /ID(_LIKE)?=.*(debian|ubuntu)/.test(os) ? "apt" : "dnf";
  return pm;
}

export type ToolStatus = { key: string; name: string; needed: boolean; neededBy: string | null; installed: boolean; version: string | null; path: string | null; install: string | null };

/** Checked through your login shell, so what counts as installed matches your own terminal. */
export async function toolchains(repo: string): Promise<ToolStatus[]> {
  const stacks = await detectStacks(repo);
  const keys = new Set(stacks.map((s) => s.key));
  return Promise.all(
    TOOLS.map(async (t) => {
      const out = (await loginShell(`p=$(command -v ${t.bin}) && echo "$p" && ${t.bin} ${t.version.join(" ")} 2>&1 | head -1`))?.split("\n") ?? null;
      const hit = t.needs.includes("*") ? "every project" : stacks.find((s) => t.needs.includes(s.key))?.evidence ?? null;
      return {
        key: t.key,
        name: t.name,
        needed: t.needs.includes("*") || t.needs.some((n) => keys.has(n)),
        neededBy: hit,
        installed: !!out,
        path: out?.[0] ?? null,
        version: out?.[1]?.trim() ?? null,
        install: t.install[packageManager()] ?? t.install.any ?? null,
      };
    }),
  );
}
