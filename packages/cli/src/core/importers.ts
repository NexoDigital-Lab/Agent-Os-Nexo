// Reading what a user already set up in another AI tool — its MCP servers and its command/file permissions — so
// `nexo import <tool>` can bring it into the library. Each reader only reads; nothing here writes. Formats as
// documented on 2026-10-07 (see aitools.ts for the links). Values are carried, never printed: env values can hold
// credentials, and they go to library/connections/ like `nexo connect` puts them.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { listDir } from "./fsx.ts";
import type { Decision } from "./permissions.ts";
import type { RuleArea } from "./permedit.ts";

export interface ImportedServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ImportedRule {
  area: RuleArea;
  decision: Decision;
  pattern: string;
}

export interface Imported {
  /** The files that were read. */
  sources: string[];
  servers: ImportedServer[];
  rules: ImportedRule[];
  /** What was found but cannot be brought in, one line each (a remote server, a path outside the environment…). */
  skipped: string[];
}

export const IMPORTABLE = ["claude", "codex", "gemini", "opencode"] as const;
export type ImportTool = (typeof IMPORTABLE)[number];

const empty = (): Imported => ({ sources: [], servers: [], rules: [], skipped: [] });

function readJsonLoose(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  // Tolerates the // and /* */ comments some of these tools allow in their JSON.
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const stringMap = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(v)).filter((e): e is [string, string] => typeof e[1] === "string"));

/** A stdio server in the common shape ({command, args, env}); remote ones are reported, not imported. */
function server(out: Imported, name: string, raw: unknown, tool: string): void {
  const s = obj(raw);
  if (typeof s.command === "string" && s.command) {
    out.servers.push({ name, command: s.command, args: strings(s.args), env: stringMap(s.env) });
  } else if (Array.isArray(s.command) && typeof s.command[0] === "string") {
    out.servers.push({ name, command: s.command[0], args: strings(s.command.slice(1)), env: stringMap(s.environment ?? s.env) });
  } else {
    out.skipped.push(`${tool} server "${name}": remote (${String(s.url ?? s.httpUrl ?? s.type ?? "no command")}) — add it with \`nexo connect ${name} --remote\``);
  }
}

/** A path rule inside the environment, relative to its root; null (and reported) outside it. */
function inside(root: string, path: string, out: Imported, label: string): string | null {
  const p = path.replace(/^\/\//, "/");
  if (!isAbsolute(p)) return p;
  const rel = relative(root, p);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    out.skipped.push(`${label} "${path}": outside the environment`);
    return null;
  }
  return rel.replace(/\\/g, "/");
}

const DECISION: Record<string, Decision | undefined> = { allow: "allow", ask: "ask", deny: "deny", prompt: "ask", forbidden: "deny", ask_user: "ask" };

/** Claude Code: ~/.claude/settings.json permissions, ~/.claude.json MCP servers. */
function fromClaude(home: string, root: string): Imported {
  const out = empty();
  const settingsFile = join(home, ".claude", "settings.json");
  const settings = readJsonLoose(settingsFile);
  if (settings) {
    out.sources.push(settingsFile);
    const perms = obj(settings.permissions);
    for (const d of ["allow", "ask", "deny"] as const) {
      for (const rule of strings(perms[d])) {
        const m = /^(Bash|Read|Edit|Write)\((.+)\)$/.exec(rule);
        if (!m?.[2]) {
          out.skipped.push(`claude ${d} "${rule}": no Nexo equivalent`);
          continue;
        }
        if (m[1] === "Bash") out.rules.push({ area: "commands", decision: d, pattern: m[2].replace(/:\*$/, "*") });
        else {
          const path = inside(root, m[2], out, `claude ${d} ${m[1]}`);
          if (path) out.rules.push({ area: m[1] === "Read" ? "files.read" : "files.edit", decision: d, pattern: path });
        }
      }
    }
  }
  const stateFile = join(home, ".claude.json");
  const state = readJsonLoose(stateFile);
  if (state && Object.keys(obj(state.mcpServers)).length) {
    out.sources.push(stateFile);
    for (const [name, raw] of Object.entries(obj(state.mcpServers))) server(out, name, raw, "claude");
  }
  return out;
}

/** Gemini CLI: ~/.gemini/settings.json (mcpServers, tools.allowed or the v1 allowedTools). */
function fromGemini(home: string): Imported {
  const out = empty();
  const file = join(home, ".gemini", "settings.json");
  const settings = readJsonLoose(file);
  if (!settings) return out;
  out.sources.push(file);
  for (const [name, raw] of Object.entries(obj(settings.mcpServers))) server(out, name, raw, "gemini");
  for (const tool of [...strings(obj(settings.tools).allowed), ...strings(settings.allowedTools)]) {
    const m = /^run_shell_command\((.+)\)$/.exec(tool);
    if (m?.[1]) out.rules.push({ area: "commands", decision: "allow", pattern: `${m[1].trim()}*` });
    else out.skipped.push(`gemini allowed "${tool}": not a shell command`);
  }
  return out;
}

/** OpenCode: ~/.config/opencode/opencode.json (mcp, permission.bash/edit/read). */
function fromOpencode(home: string, root: string): Imported {
  const out = empty();
  const file = join(home, ".config", "opencode", "opencode.json");
  const config = readJsonLoose(file);
  if (!config) return out;
  out.sources.push(file);
  for (const [name, raw] of Object.entries(obj(config.mcp))) server(out, name, raw, "opencode");
  const permission = obj(config.permission);
  const areas: [string, RuleArea][] = [["bash", "commands"], ["edit", "files.edit"], ["read", "files.read"]];
  for (const [key, area] of areas) {
    for (const [pattern, value] of Object.entries(obj(permission[key]))) {
      const decision = DECISION[String(value)];
      if (pattern === "*" || !decision) continue; // the catch-all is the tool's default, not a rule
      const p = area === "commands" ? pattern : inside(root, pattern, out, `opencode ${key}`);
      if (p) out.rules.push({ area, decision, pattern: p });
    }
  }
  return out;
}

/** Codex: ~/.codex/config.toml [mcp_servers.*] and ~/.codex/rules/*.rules prefix_rule(). */
function fromCodex(home: string): Imported {
  const out = empty();
  const file = join(home, ".codex", "config.toml");
  if (existsSync(file)) {
    out.sources.push(file);
    for (const s of parseCodexServers(readFileSync(file, "utf8"))) {
      if (s.command) out.servers.push({ name: s.name, command: s.command, args: s.args, env: s.env });
      else out.skipped.push(`codex server "${s.name}": remote — add it with \`nexo connect ${s.name} --remote\``);
    }
  }
  const rulesDir = join(home, ".codex", "rules");
  for (const f of listDir(rulesDir).filter((x) => x.endsWith(".rules"))) {
    out.sources.push(join(rulesDir, f));
    const text = readFileSync(join(rulesDir, f), "utf8");
    for (const m of text.matchAll(/prefix_rule\s*\(([\s\S]*?)\)\s*(?:\n|$)/g)) {
      const body = m[1] ?? "";
      const pattern = /pattern\s*=\s*\[([^\]]*(?:\[[^\]]*\][^\]]*)*)\]/.exec(body)?.[1] ?? "";
      if (/\[/.test(pattern)) {
        out.skipped.push(`codex rule [${pattern.trim()}]: alternatives in a pattern have no Nexo equivalent`);
        continue;
      }
      const tokens = [...pattern.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((t) => t[1] ?? "");
      const decision = DECISION[/decision\s*=\s*"(\w+)"/.exec(body)?.[1] ?? "allow"];
      if (tokens.length && decision) out.rules.push({ area: "commands", decision, pattern: `${tokens.join(" ")}*` });
    }
  }
  return out;
}

/** The [mcp_servers.<name>] tables of a Codex config: command, args, env (inline table or [mcp_servers.<name>.env]). */
export function parseCodexServers(toml: string): { name: string; command: string; args: string[]; env: Record<string, string> }[] {
  const servers = new Map<string, { name: string; command: string; args: string[]; env: Record<string, string> }>();
  let current: { name: string; command: string; args: string[]; env: Record<string, string> } | null = null;
  let inEnv = false;
  const value = (raw: string): unknown => {
    const v = raw.trim();
    if (v.startsWith("{")) {
      const env: Record<string, string> = {};
      for (const m of v.slice(1, -1).matchAll(/([A-Za-z0-9_."-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) env[(m[1] ?? "").replace(/"/g, "")] = JSON.parse(`"${m[2] ?? ""}"`) as string;
      return env;
    }
    try {
      return JSON.parse(v.replace(/'([^']*)'/g, '"$1"')) as unknown;
    } catch {
      return v;
    }
  };
  for (const line of toml.split(/\r?\n/)) {
    const t = line.replace(/\s+#.*$/, "").trim();
    const table = /^\[([^\]]+)\]$/.exec(t);
    if (table?.[1]) {
      const parts = table[1].split(".").map((p) => p.replace(/^"|"$/g, ""));
      inEnv = parts.length === 3 && parts[0] === "mcp_servers" && parts[2] === "env";
      if (parts[0] === "mcp_servers" && parts[1]) {
        const name = parts[1];
        current = servers.get(name) ?? { name, command: "", args: [], env: {} };
        servers.set(name, current);
      } else current = null;
      continue;
    }
    const kv = /^([A-Za-z0-9_"-]+)\s*=\s*(.+)$/.exec(t);
    if (!current || !kv?.[1] || kv[2] === undefined) continue;
    const key = kv[1].replace(/"/g, "");
    const v = value(kv[2]);
    if (inEnv) {
      if (typeof v === "string") current.env[key] = v;
    } else if (key === "command" && typeof v === "string") current.command = v;
    else if (key === "args") current.args = strings(v);
    else if (key === "env") current.env = stringMap(v);
  }
  return [...servers.values()];
}

/** What `tool` has set up, read from its files under `home`; paths are made relative to the environment `root`. */
export function readTool(tool: ImportTool, home: string, root: string): Imported {
  if (tool === "claude") return fromClaude(home, root);
  if (tool === "gemini") return fromGemini(home);
  if (tool === "opencode") return fromOpencode(home, root);
  return fromCodex(home);
}
