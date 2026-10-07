// The shared AI-provider registry: which providers agent-os-nexo knows, how to detect their CLIs on this
// machine (Windows-safe — execFile cannot run .cmd/.bat shims, so those resolve through cmd.exe /c), and
// library/providers.json read/write. Sessions routing (T2) adapts claude.ts over this same registry.
import { readFileSync } from "node:fs";
import { findBin, httpError, run, writeJson } from "./http.ts";

export type ProviderId = "claude" | "opencode" | "codex" | "antigravity";
export type ProviderKind = "sdk" | "cli";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** Candidate CLI names, first found wins. */
  binaries: string[];
  install: { win32: string; posix: string };
  loginHint: string;
}

export interface DetectedProvider {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  found: boolean;
  path: string | null;
  version: string | null;
  install: string;
  loginHint: string;
}

/** What a headless provider run produced: the trimmed answer text and the raw stdout. */
export interface AskResult {
  text: string;
  raw: string;
}

/** The fixed v1 registry. claude is the bundled SDK; the rest are CLIs spawned headless. */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: "claude",
    label: "Claude",
    kind: "sdk",
    binaries: [],
    install: {
      win32: "npm install -g @anthropic-ai/claude-code",
      posix: "npm install -g @anthropic-ai/claude-code",
    },
    loginHint: "Sign in with the claude CLI, or use the app's bundled SDK session.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    kind: "cli",
    binaries: ["opencode"],
    install: {
      win32: "npm install -g opencode-ai",
      posix: "npm install -g opencode-ai",
    },
    loginHint: "Run opencode once and complete its login.",
  },
  {
    id: "codex",
    label: "Codex",
    kind: "cli",
    binaries: ["codex"],
    install: {
      win32: "npm install -g @openai/codex",
      posix: "npm install -g @openai/codex",
    },
    loginHint: "Run codex login.",
  },
  {
    id: "antigravity",
    label: "Antigravity (Google)",
    kind: "cli",
    binaries: ["agy", "gemini"],
    install: {
      win32: "irm https://antigravity.google/cli/install.ps1 | iex (legacy: npm install -g @google/gemini-cli)",
      posix: "curl -fsSL https://antigravity.google/cli/install.sh | bash (legacy: npm install -g @google/gemini-cli)",
    },
    loginHint: "Run agy once and complete its Google sign-in.",
  },
];

export const providerById = (id: string): ProviderMeta | undefined => PROVIDERS.find((p) => p.id === id);

/** The process launcher and binary finder; tests swap both so no real CLI runs. */
export const providerExec: {
  run: typeof run;
  find: (name: string) => string | null;
} = {
  run,
  find: (name: string) => findBin(name),
};

/**
 * Resolves a CLI on this machine, Windows-safe: for each candidate name, in order, try the plain name then
 * the .cmd/.bat shims npm writes. A shim cannot be execFile'd directly, so a hit ending in .cmd/.bat is
 * wrapped in cmd.exe /c. First hit wins; nothing found is null.
 */
export function resolveCli(
  names: string[],
  platform: NodeJS.Platform = process.platform,
  find: (name: string) => string | null = findBin,
): { cmd: string; pre: string[]; path: string } | null {
  void platform; // candidate list is uniform; the wrap rule keys off the hit's extension
  for (const name of names) {
    for (const candidate of [name, `${name}.cmd`, `${name}.bat`]) {
      const hit = find(candidate);
      if (!hit) continue;
      if (/\.(cmd|bat)$/i.test(hit)) return { cmd: process.env.ComSpec ?? "cmd.exe", pre: ["/c", hit], path: hit };
      return { cmd: hit, pre: [], path: hit };
    }
  }
  return null;
}

/** Headless argv per CLI provider, prompt as ONE argument (verified where possible: opencode run, codex exec, agy -p). */
function headlessArgs(id: ProviderId, prompt: string): string[] {
  if (id === "opencode") return ["run", prompt]; // `opencode run [message..]` (v1.18.29)
  if (id === "codex") return ["exec", prompt]; // `codex exec "…"`
  if (id === "antigravity") return ["-p", prompt]; // `agy -p "…"`; legacy `gemini -p "…"` shares the flag
  throw httpError(502, `Provider ${id} runs through the Claude SDK, not a headless CLI`);
}

/**
 * Runs a CLI provider headless in `cwd`. stdout is the answer text (trimmed). Throws httpError(502, …)
 * on a non-zero exit (with a trimmed stderr/stdout tail, docker.ts style) or empty output; a killed
 * process (our own timeout) is a 504, same as docker. claude is not handled here — it is the SDK path.
 */
export async function askWithProvider(
  id: ProviderId,
  prompt: string,
  opts: { cwd: string; timeoutMs?: number },
): Promise<AskResult> {
  const meta = providerById(id);
  if (!meta) throw httpError(502, `Unknown provider: ${id}`);
  if (meta.kind !== "cli") throw httpError(502, `Provider ${id} runs through the Claude SDK, not a headless CLI`);
  const cli = resolveCli(meta.binaries, process.platform, providerExec.find);
  if (!cli) throw httpError(502, `${meta.label} is not installed (or not on PATH)`);
  const argv = headlessArgs(id, prompt);
  const timeout = opts.timeoutMs ?? 120_000;
  try {
    const out = await providerExec.run(cli.cmd, [...cli.pre, ...argv], { timeout, cwd: opts.cwd });
    const text = (out.stdout ?? "").trim();
    if (!text) throw httpError(502, `${meta.label} returned no output`);
    return { text, raw: out.stdout ?? "" };
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e; // our own httpError above passes through
    const err = e as { stderr?: string; stdout?: string; killed?: boolean; message?: string };
    if (err.killed) throw httpError(504, `${meta.label} took more than ${Math.round(timeout / 1000)} s to answer`);
    const tail = String(err.stderr || err.stdout || err.message || "failed")
      .trim()
      .split("\n")
      .slice(-3)
      .join("\n")
      .trim();
    throw httpError(502, `${meta.label} failed: ${tail || "no output"}`);
  }
}

/** agent-os-nexo's own version (the SDK is bundled with the app); null when the package.json is unreadable. */
function sdkVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

export interface DetectDeps {
  find?: (name: string) => string | null;
  run?: typeof run;
}

/** Detects one provider: the SDK is always present (version from apps/os/package.json); CLIs are probed. */
export async function detectProvider(
  meta: ProviderMeta,
  platform: NodeJS.Platform = process.platform,
  deps?: DetectDeps,
): Promise<DetectedProvider> {
  const find = deps?.find ?? providerExec.find;
  const runFn = deps?.run ?? providerExec.run;
  const install = meta.install[platform === "win32" ? "win32" : "posix"];
  const base = { id: meta.id, label: meta.label, kind: meta.kind, install, loginHint: meta.loginHint };
  if (meta.kind === "sdk") return { ...base, found: true, path: null, version: sdkVersion() };
  const cli = resolveCli(meta.binaries, platform, find);
  if (!cli) return { ...base, found: false, path: null, version: null };
  let version: string | null = null;
  try {
    // Best-effort: a binary that exists but fails --version still counts as installed.
    const out = await runFn(cli.cmd, [...cli.pre, "--version"], { timeout: 8000 });
    version = out.stdout.split(/\r?\n/, 1)[0]?.trim() || null;
  } catch {
    version = null;
  }
  return { ...base, found: true, path: cli.path, version };
}

/** Every registry provider, in registry order. */
export async function detectAll(deps?: DetectDeps): Promise<DetectedProvider[]> {
  return Promise.all(PROVIDERS.map((p) => detectProvider(p, process.platform, deps)));
}

/** library/providers.json: which providers the user enabled and which one is the default. */
export interface ProvidersFile {
  enabled: ProviderId[];
  default: ProviderId | null;
}

const isProviderId = (x: unknown): x is ProviderId => typeof x === "string" && PROVIDERS.some((p) => p.id === x);

/** Missing file (or nothing valid in it): seed from the CLI's tools map; no overlap falls back to claude. */
function seedFromTools(tools?: Record<string, boolean>): ProvidersFile {
  const enabled = Object.entries(tools ?? {})
    .filter(([, on]) => on)
    .map(([k]) => k)
    .filter(isProviderId);
  if (!enabled.length) return { enabled: ["claude"], default: "claude" };
  return { enabled, default: enabled[0] ?? null };
}

/** Reads providers.json; unknown ids are dropped and the default falls back to the first enabled provider. */
export function readProvidersFile(file: string, fallbackTools?: Record<string, boolean>): ProvidersFile {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return seedFromTools(fallbackTools);
  }
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const enabled = Array.isArray(obj.enabled) ? [...new Set(obj.enabled.filter(isProviderId))] : [];
  if (!enabled.length) return seedFromTools(fallbackTools);
  const def = isProviderId(obj.default) && enabled.includes(obj.default) ? obj.default : (enabled[0] ?? null);
  return { enabled, default: def };
}

/** Writes providers.json (pretty JSON + newline, atomic, parent dirs created); default stays inside enabled. */
export function writeProvidersFile(file: string, value: ProvidersFile): void {
  const enabled = [...new Set(value.enabled.filter(isProviderId))];
  const def = value.default && enabled.includes(value.default) ? value.default : (enabled[0] ?? null);
  writeJson(file, { enabled, default: def });
}
