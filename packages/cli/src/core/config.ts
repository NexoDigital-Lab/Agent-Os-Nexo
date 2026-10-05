import { join } from "node:path";
import { CONFIG_FILE } from "./paths.ts";
import { readJson, writeJson } from "./fsx.ts";

export const TOOLS = ["claude", "codex", "gemini", "opencode"] as const;
export type Tool = (typeof TOOLS)[number];

export interface SystemSummary {
  os: string;
  release: string;
  arch: string;
  shell: string;
  packageManager: string | null;
  toolchains: Record<string, string>;
  lastAnalysis: string;
}

export interface EnvironmentConfig {
  nexo: { version: string; updatePolicy: "owner" };
  root: string;
  tools: Record<Tool, boolean>;
  folders: { library: string; blueprints: string; projects: string; os: string; state: string };
  system: SystemSummary | null;
}

export const DEFAULT_FOLDERS: EnvironmentConfig["folders"] = {
  library: "library",
  blueprints: "blueprints",
  projects: "projects",
  os: "os",
  state: ".state",
};

export function readConfig(root: string): EnvironmentConfig {
  return readJson<EnvironmentConfig>(join(root, CONFIG_FILE));
}

export function writeConfig(root: string, config: EnvironmentConfig): void {
  writeJson(join(root, CONFIG_FILE), config);
}

export function enabledTools(config: EnvironmentConfig): Tool[] {
  return TOOLS.filter((tool) => config.tools[tool]);
}

export function folder(root: string, config: EnvironmentConfig, key: keyof EnvironmentConfig["folders"]): string {
  return join(root, config.folders[key]);
}
