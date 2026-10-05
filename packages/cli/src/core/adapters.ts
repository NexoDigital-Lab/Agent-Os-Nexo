import { existsSync } from "node:fs";
import { join } from "node:path";
import { enabledTools, folder, type EnvironmentConfig } from "./config.ts";
import { listConnections, mcpServersFor } from "./connections.ts";
import { listDir, readJson, writeJson, writeText } from "./fsx.ts";
import { toClaudePermissions, type Permissions } from "./permissions.ts";

const CLAUDE_EVENTS: Record<string, string> = {
  "pre-tool": "PreToolUse",
  "post-tool": "PostToolUse",
  "session-start": "SessionStart",
  prompt: "UserPromptSubmit",
  stop: "Stop",
};

interface NexoHook {
  event: string;
  match: string;
  run: string;
}

function claudeHooks(libraryDir: string): Record<string, unknown[]> {
  const hooks: Record<string, unknown[]> = {};
  const dir = join(libraryDir, "hooks");
  for (const file of listDir(dir).filter((f) => f.endsWith(".json"))) {
    const hook = readJson<NexoHook>(join(dir, file));
    const event = CLAUDE_EVENTS[hook.event];
    if (!event) continue;
    const command = hook.run.startsWith("scripts/") ? `node "${join(dir, hook.run)}"` : hook.run;
    const entry: Record<string, unknown> = { hooks: [{ type: "command", command }] };
    // Command patterns are checked by the hook itself; Claude matches on the tool name.
    if (event === "PreToolUse" || event === "PostToolUse") entry.matcher = "Bash";
    (hooks[event] ??= []).push(entry);
  }
  return hooks;
}

function mergeJson(path: string, patch: Record<string, unknown>): void {
  const current = existsSync(path) ? readJson<Record<string, unknown>>(path) : {};
  writeJson(path, { ...current, ...patch });
}

/**
 * Generates the per-AI files next to an AGENTS.md (the environment root or a project folder):
 * pointers to AGENTS.md, translated permissions, hooks and MCP servers. Returns written paths.
 */
export function generateAdapters(
  root: string,
  config: EnvironmentConfig,
  targetDir: string,
  permissions: Permissions,
): string[] {
  const written: string[] = [];
  const libraryDir = folder(root, config, "library");
  const connections = listConnections(libraryDir);

  for (const tool of enabledTools(config)) {
    if (tool === "claude") {
      writeText(join(targetDir, ".claude", "CLAUDE.md"), "@../AGENTS.md");
      mergeJson(join(targetDir, ".claude", "settings.json"), {
        permissions: toClaudePermissions(permissions, root),
        hooks: claudeHooks(libraryDir),
      });
      writeJson(join(targetDir, ".mcp.json"), { mcpServers: mcpServersFor(connections, "claude") });
      written.push(".claude/CLAUDE.md", ".claude/settings.json", ".mcp.json");
    } else if (tool === "gemini") {
      mergeJson(join(targetDir, ".gemini", "settings.json"), {
        contextFileName: "AGENTS.md",
        mcpServers: mcpServersFor(connections, "gemini"),
      });
      written.push(".gemini/settings.json");
    }
    // codex and opencode read AGENTS.md natively; nothing to generate yet.
  }
  return written;
}
