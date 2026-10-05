import { existsSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { basesDir, findRoot } from "../core/paths.ts";
import { folder, readConfig, writeConfig, type SystemSummary } from "../core/config.ts";
import { readJson, readText, writeJson } from "../core/fsx.ts";
import { tryRun } from "../core/exec.ts";

interface AnalysisCommand {
  toolchains: Array<{ name: string; run: string[] }>;
  packageManagers: string[];
}

const VERSION = /\d+(?:\.\d+)+/;

function osName(): string {
  if (platform() === "linux" && existsSync("/etc/os-release")) {
    const text = readText("/etc/os-release");
    const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(text);
    if (pretty?.[1]) return pretty[1];
  }
  return platform();
}

export function analyze(opts: { root?: string; now?: Date }): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const userDef = join(folder(root, config, "library"), "commands", "os-analysis.json");
  const def = readJson<AnalysisCommand>(existsSync(userDef) ? userDef : join(basesDir, "library", "commands", "os-analysis.json"));

  const toolchains: Record<string, string> = {};
  const raw: Record<string, string | null> = {};
  for (const tc of def.toolchains) {
    const [cmd, ...args] = tc.run;
    if (!cmd) continue;
    const out = tryRun(cmd, args);
    raw[tc.name] = out;
    const version = out ? VERSION.exec(out)?.[0] : undefined;
    if (version) toolchains[tc.name] = version;
  }
  const locator = platform() === "win32" ? "where" : "which";
  const packageManager = def.packageManagers.find((pm) => tryRun(locator, [pm]) !== null) ?? null;

  const now = (opts.now ?? new Date()).toISOString();
  const system: SystemSummary = {
    os: osName(),
    release: release(),
    arch: arch(),
    shell: process.env.SHELL ?? process.env.ComSpec ?? "unknown",
    packageManager,
    toolchains,
    lastAnalysis: now,
  };
  config.system = system;
  writeConfig(root, config);
  const detail = join(folder(root, config, "state"), "analysis", `${now.replace(/[:.]/g, "-")}.json`);
  writeJson(detail, { system, raw });

  const found = Object.entries(toolchains).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    `${system.os} (${system.arch}) · shell ${system.shell} · package manager ${packageManager ?? "none found"}`,
    `Toolchains: ${found || "none found"}`,
    `Summary saved to environment.config.json; detail in ${detail.slice(root.length + 1)}`,
  ].join("\n");
}
