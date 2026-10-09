import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findRoot } from "../core/paths.ts";
import { enabledTools, folder, readConfig, type EnvironmentConfig } from "../core/config.ts";
import { parseFrontmatter } from "../core/frontmatter.ts";
import { isDir, listDir, readJson, readText } from "../core/fsx.ts";
import { loadPermissions, validatePermissions } from "../core/permissions.ts";
import { listProjectDirs } from "../core/projects.ts";
import { unenforced } from "../core/aitools.ts";
import { frameworkContributions } from "../core/adapters.ts";
import { defaultFramework, loadFrameworks, NEXO_METHOD } from "../core/frameworks.ts";
import { buildTarget, currentTarget } from "../core/osruntime.ts";
import { activeVersion } from "../core/osversions.ts";
import { binaryPath, engramPaths, MEMORY_CONNECTION, readPin } from "../core/engram.ts";

export type Level = "ok" | "warn" | "error";
export interface Finding {
  level: Level;
  area: string;
  message: string;
}

const STALE_DAYS = 7;
const MODEL_RANK: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3 };

function lines(text: string): number {
  return text.replace(/\n$/, "").split("\n").length;
}

function checkFrontmatter(findings: Finding[], area: string, file: string, required: string[], maxLines?: number): Record<string, unknown> {
  if (!existsSync(file)) {
    findings.push({ level: "error", area, message: `missing ${file}` });
    return {};
  }
  const text = readText(file);
  const { data, hasFrontmatter } = parseFrontmatter(text);
  if (!hasFrontmatter) findings.push({ level: "error", area, message: "no frontmatter" });
  for (const key of required) {
    if (!data[key]) findings.push({ level: "error", area, message: `frontmatter is missing "${key}"` });
  }
  if (maxLines && lines(text) > maxLines) {
    findings.push({ level: "warn", area, message: `${lines(text)} lines (max ${maxLines}); move detail to references/` });
  }
  return data;
}

export function staleAnalysis(config: EnvironmentConfig, now = new Date()): string | null {
  const last = config.system?.lastAnalysis;
  if (!last) return "the OS has never been analyzed — run `nexo analyze`";
  const days = (now.getTime() - new Date(last).getTime()) / 86_400_000;
  return days > STALE_DAYS ? `the OS analysis is ${Math.floor(days)} days old — run \`nexo analyze\`` : null;
}

/** Agent memory: Engram is third party; its pinned binary and Nexo's connection must both be there. */
function checkMemory(findings: Finding[], root: string, config: EnvironmentConfig): void {
  if (config.memory !== "engram") return;
  const pin = readPin();
  const paths = engramPaths(root, config);
  const area = "memory";
  findings.push({ level: "ok", area, message: `Engram ${pin.version} (third party, MIT), reached only through \`nexo memory mcp\`` });
  if (!existsSync(binaryPath(paths, pin.version))) findings.push({ level: "warn", area, message: `Engram ${pin.version} is not installed — run \`nexo memory update\`` });
  if (!existsSync(join(folder(root, config, "library"), "connections", `${MEMORY_CONNECTION}.json`))) {
    findings.push({ level: "warn", area, message: "the memory connection is missing — run `nexo memory install`" });
  }
}

/** Third-party frameworks: listed as such, with their name clashes and hooks still waiting for approval. */
function checkFrameworks(findings: Finding[], root: string, config: EnvironmentConfig): void {
  const { frameworks, broken } = loadFrameworks(root, config);
  for (const b of broken) findings.push({ level: "warn", area: `framework ${b}`, message: "unreadable framework.json" });
  for (const fw of frameworks) {
    const where = !fw.enabled ? "disabled" : fw.kind === "tool" ? "an enabled tool" : defaultFramework(config) === fw.name ? "the default method" : "an available method";
    findings.push({ level: "ok", area: `framework ${fw.name}`, message: `third-party (${fw.source}, ${fw.managed === "external" ? "managed elsewhere" : "installed by nexo"}), ${where}` });
    if (!isDir(fw.contentRoot)) findings.push({ level: "warn", area: `framework ${fw.name}`, message: `its files are missing at ${fw.contentRoot}` });
  }
  if (!frameworks.length) return;
  const wired = frameworkContributions(root, config);
  const def = defaultFramework(config);
  if (def !== NEXO_METHOD && !frameworks.some((f) => f.name === def && f.enabled && f.kind === "method")) {
    findings.push({ level: "warn", area: "frameworks", message: `the default method "${def}" is missing or not enabled — \`nexo framework default nexo\`` });
  }
  for (const c of wired.clashes) findings.push({ level: "warn", area: "frameworks", message: `name clash: ${c}` });
  for (const name of Object.keys(wired.pendingHooks)) findings.push({ level: "warn", area: `framework ${name}`, message: `has hooks that are not approved and stay off — review them, then \`nexo framework enable ${name} --hooks\`` });
}

export function diagnose(root: string, quick = false): Finding[] {
  const findings: Finding[] = [];
  let config: EnvironmentConfig;
  try {
    config = readConfig(root);
  } catch (error) {
    return [{ level: "error", area: "config", message: `unreadable: ${(error as Error).message}` }];
  }

  for (const [key, rel] of Object.entries(config.folders)) {
    if (!isDir(join(root, rel))) findings.push({ level: "error", area: "folders", message: `${key} folder missing: ${rel}/` });
  }
  const agents = join(root, "AGENTS.md");
  if (!existsSync(agents)) findings.push({ level: "error", area: "AGENTS.md", message: "missing at the root" });
  else if (lines(readText(agents)) > 120) {
    findings.push({ level: "warn", area: "AGENTS.md", message: `${lines(readText(agents))} lines (max 120)` });
  }
  for (const tool of enabledTools(config)) {
    if (tool === "claude" && !existsSync(join(root, ".claude", "CLAUDE.md"))) {
      findings.push({ level: "error", area: "claude", message: "missing .claude/CLAUDE.md — run `nexo update`" });
    }
    if (tool === "gemini" && !existsSync(join(root, ".gemini", "settings.json"))) {
      findings.push({ level: "error", area: "gemini", message: "missing .gemini/settings.json — run `nexo update`" });
    }
    if (tool === "opencode" && !existsSync(join(root, "opencode.json"))) {
      findings.push({ level: "error", area: "opencode", message: "missing opencode.json — run `nexo update`" });
    }
    if (tool === "codex" && !existsSync(join(root, ".codex", "rules", "nexo.rules"))) {
      findings.push({ level: "error", area: "codex", message: "missing .codex/rules/nexo.rules — run `nexo update`" });
    }
    // Rules this AI's own files cannot express: the user should know they hold only for the others.
    const gaps = unenforced(tool, loadPermissions(join(folder(root, config, "library"), "permissions.json")));
    if (gaps.length) findings.push({ level: "warn", area: tool, message: `not enforced by ${tool}: ${gaps.join("; ")}` });
  }
  checkFrameworks(findings, root, config);
  checkMemory(findings, root, config);
  const stale = staleAnalysis(config);
  if (stale) findings.push({ level: "warn", area: "analysis", message: stale });
  if (quick) return findings;

  const library = folder(root, config, "library");
  if (!existsSync(join(library, "index.json"))) {
    findings.push({ level: "warn", area: "library", message: "index.json missing — run `nexo index`" });
  }
  for (const name of listDir(join(library, "skills"))) {
    const data = checkFrontmatter(findings, `skill ${name}`, join(library, "skills", name, "SKILL.md"), ["name", "description", "owner", "version"], 200);
    if (data.name && data.name !== name) {
      findings.push({ level: "warn", area: `skill ${name}`, message: `name "${String(data.name)}" differs from its folder` });
    }
  }
  const profilePath = join(library, "profile.json");
  const profile = existsSync(profilePath)
    ? readJson<{ models?: { subagentCeiling?: string } }>(profilePath)
    : {};
  const ceiling = profile.models?.subagentCeiling ?? "sonnet";
  for (const file of listDir(join(library, "agents")).filter((f) => f.endsWith(".md"))) {
    const data = checkFrontmatter(findings, `agent ${file}`, join(library, "agents", file), ["name", "description", "owner", "model"]);
    const model = String(data.model ?? "");
    if (model && (MODEL_RANK[model] ?? 99) > (MODEL_RANK[ceiling] ?? 2)) {
      findings.push({ level: "warn", area: `agent ${file}`, message: `model "${model}" is above the ceiling "${ceiling}" in profile.json` });
    }
  }
  for (const file of listDir(join(library, "hooks")).filter((f) => f.endsWith(".json"))) {
    const hook = readJson<Record<string, unknown>>(join(library, "hooks", file));
    for (const key of ["event", "match", "run", "description"]) {
      if (!hook[key]) findings.push({ level: "error", area: `hook ${file}`, message: `missing "${key}"` });
    }
  }
  for (const problem of validatePermissions(loadPermissions(join(library, "permissions.json")))) {
    findings.push({ level: "error", area: "permissions.json", message: problem });
  }
  for (const dir of listProjectDirs(root, config)) {
    const rel = dir.slice(root.length + 1).replace(/\\/g, "/");
    if (!dir.endsWith("-ws") && !isDir(join(dir, "code"))) {
      findings.push({ level: "warn", area: rel, message: "no code/ folder" });
    }
    // The code index agents read first (context/map/): missing on projects added before it existed or by hand.
    const code = join(dir, "code");
    if (isDir(code) && readdirSync(code).some((f) => f !== ".git") && !existsSync(join(dir, "context", "map", "README.md"))) {
      findings.push({ level: "warn", area: rel, message: `no code index: run \`nexo map ${dir.slice(folder(root, config, "projects").length + 1) || rel}\`` });
    }
    for (const problem of validatePermissions(loadPermissions(join(dir, "context", "permissions.json")))) {
      findings.push({ level: "error", area: `${rel}/context/permissions.json`, message: problem });
    }
  }
  // The build agent-os-nexo starts must have been installed for this machine (an environment used from two OSes).
  const osDir = folder(root, config, "os");
  const active = activeVersion(osDir);
  const target = active ? buildTarget(osDir, active) : null;
  if (active && target && target !== currentTarget()) {
    findings.push({ level: "error", area: "agent-os-nexo", message: `build ${active} was installed for ${target}, this machine is ${currentTarget()}: run \`nexo os build\`` });
  }
  return findings;
}

export function doctor(opts: { root?: string; quick?: boolean; json?: boolean }): { output: string; failed: boolean } {
  const root = findRoot(opts.root);
  const findings = diagnose(root, opts.quick);
  const failed = findings.some((f) => f.level === "error");
  if (opts.json) return { output: JSON.stringify(findings, null, 2), failed };
  if (!findings.length) return { output: "Nexo environment looks good.", failed };
  const icon: Record<Level, string> = { ok: "ok", warn: "warn", error: "ERROR" };
  const output = findings.map((f) => `[${icon[f.level]}] ${f.area}: ${f.message}`).join("\n");
  return { output: `${output}\n\nnexo doctor only reports; nothing was changed.`, failed };
}
