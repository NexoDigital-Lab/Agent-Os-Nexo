// The shared shape of third-party agent frameworks as agent-os-nexo sees them: what `nexo framework list --json` says,
// validated before anything trusts it, and a counter modules bump when they change a framework so the sessions module
// refreshes what it cached. Like providers.ts, this is host code so the Frameworks view (settings) and the chat tabs
// (sessions) agree without depending on each other. The framework files themselves are the CLI's business.
import { httpError } from "./http.ts";

/** The environment's own method: no framework. Always a valid choice for a tab. */
export const NEXO_METHOD = "nexo";
/** Same shape the CLI accepts for a framework folder name (packages/cli core/frameworks.ts). */
export const FRAMEWORK_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type FrameworkKind = "method" | "tool";

export interface FrameworkInfo {
  name: string;
  kind: FrameworkKind;
  source: string;
  version: string;
  license: string;
  managed: "nexo" | "external";
  enabled: boolean;
  hooksApproved: boolean;
  /** The exact commands its hooks would run on every tool call (what the user approves). */
  hookCommands: string[];
  contributions: { skills: string[]; agents: string[]; commands: string[]; mcpServers: string[]; instructions: string[]; hooks: number };
  isDefault: boolean;
}

export interface FrameworksList {
  /** The environment's default method: a framework name, or "nexo". */
  default: string;
  frameworks: FrameworkInfo[];
  /** Folders under frameworks/ whose framework.json cannot be read. */
  broken: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Reads the CLI's JSON; anything malformed is a 502 (the CLI is older or broken), never a half-trusted value. */
export function parseFrameworksList(stdout: string): FrameworksList {
  let raw: Record<string, unknown>;
  try {
    raw = obj(JSON.parse(stdout));
  } catch {
    throw httpError(502, "The nexo CLI answered something that is not JSON: update it (npm install -g @nexodigital/nexo).");
  }
  if (!Array.isArray(raw.frameworks)) throw httpError(502, "Your nexo CLI cannot list frameworks as JSON yet: update it (npm install -g @nexodigital/nexo).");
  const frameworks: FrameworkInfo[] = [];
  for (const item of raw.frameworks) {
    const f = obj(item);
    if (typeof f.name !== "string" || !FRAMEWORK_NAME.test(f.name)) continue;
    const c = obj(f.contributions);
    frameworks.push({
      name: f.name,
      kind: f.kind === "tool" ? "tool" : "method",
      source: String(f.source ?? ""),
      version: String(f.version ?? "unknown"),
      license: String(f.license ?? "unknown"),
      managed: f.managed === "nexo" ? "nexo" : "external",
      enabled: f.enabled === true,
      hooksApproved: f.hooksApproved === true,
      hookCommands: strings(f.hookCommands),
      contributions: {
        skills: strings(c.skills), agents: strings(c.agents), commands: strings(c.commands),
        mcpServers: strings(c.mcpServers), instructions: strings(c.instructions),
        hooks: typeof c.hooks === "number" ? c.hooks : 0,
      },
      isDefault: f.isDefault === true,
    });
  }
  const def = typeof raw.default === "string" && raw.default ? raw.default : NEXO_METHOD;
  return { default: def, frameworks, broken: strings(raw.broken) };
}

/** Every method a tab may pick: enabled frameworks of kind method (tools are always on, never picked). */
export const pickableMethods = (list: FrameworksList): FrameworkInfo[] => list.frameworks.filter((f) => f.kind === "method" && f.enabled);

// Bumped by the Frameworks module on every change it makes; sessions drops its cached list when it moves.
let changes = 0;
export const frameworksVersion = (): number => changes;
export function bumpFrameworks(): void {
  changes++;
}
