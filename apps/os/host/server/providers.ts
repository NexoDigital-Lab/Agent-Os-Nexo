// The shared AI-provider registry: which providers agent-os-nexo knows, how to detect their CLIs on this
// machine (Windows-safe — a .cmd shim runs its script with node, never through cmd.exe: winshell.ts), and
// library/providers.json read/write. Sessions routing (T2) adapts claude.ts over this same registry.
// Round 2 added codex profiles and the gemini provider.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import { findBin, httpError, run, writeJson } from "./http.ts";
import { CMD_META, cmdShimTargets } from "./winshell.ts";

export type ProviderId = "claude" | "opencode" | "codex" | "gemini";
export type ProviderKind = "sdk" | "cli";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  /** Candidate CLI names, first found wins. */
  binaries: string[];
  install: { win32: string; posix: string };
  loginHint: string;
  /** What the chat Composer can offer for this provider: agent picker and/or model picker. */
  supports: { agent?: boolean; model?: boolean };
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
  supports: { agent?: boolean; model?: boolean };
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
    supports: { model: true }, // the SDK model dropdown already exists in the Composer
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
    supports: { agent: true, model: true },
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
    supports: { agent: true, model: true }, // agents are the profiles of $CODEX_HOME (--profile)
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    kind: "cli",
    binaries: ["gemini"],
    install: {
      win32: "npm install -g @google/gemini-cli",
      posix: "npm install -g @google/gemini-cli",
    },
    loginHint: "Run gemini once and complete its Google sign-in.",
    supports: { agent: true, model: true }, // agents are extensions (`gemini -l`); the model is free text
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
 * Resolves a CLI on this machine: for each candidate name, the first hit wins. On Windows npm installs a .cmd shim
 * next to a shell script execFile cannot run; the shim is checked first, and its script (`"%dp0%\…\cli.js"`) runs
 * with node directly — cmd.exe would parse & | < > ^ % ! " inside the prompt and run them (CVE-2024-27980 class).
 * Only a shim that is not npm's falls back to cmd.exe (`viaCmd`), and askWithProvider then refuses any argument
 * cmd.exe would interpret. Nothing found is null.
 */
export function resolveCli(
  names: string[],
  platform: NodeJS.Platform = process.platform,
  find: (name: string) => string | null = findBin,
  script: (cmdFile: string) => string | null = (f) => cmdShimTargets(f).find((t) => /\.(c|m)?js$/i.test(t)) ?? null,
): { cmd: string; pre: string[]; path: string; viaCmd: boolean } | null {
  const order = (name: string): string[] =>
    platform === "win32" ? [`${name}.cmd`, `${name}.bat`, name] : [name, `${name}.cmd`, `${name}.bat`];
  for (const name of names) {
    for (const candidate of order(name)) {
      const hit = find(candidate);
      if (!hit) continue;
      if (/\.(cmd|bat)$/i.test(hit)) {
        const js = script(hit);
        if (js) return { cmd: process.execPath, pre: [js], path: hit, viaCmd: false };
        return { cmd: process.env.ComSpec ?? "cmd.exe", pre: ["/c", hit], path: hit, viaCmd: true };
      }
      return { cmd: hit, pre: [], path: hit, viaCmd: false };
    }
  }
  return null;
}

/**
 * The longest prompt a CLI gets as one argument: Windows' CreateProcess caps the whole command line at 32,767
 * characters, Linux a single argument at 128 KiB. Callers trim history to fit (agent.ts).
 */
export const MAX_PROMPT_ARG = process.platform === "win32" ? 30_000 : 120_000;

/** The chat Composer's permission mode, as each CLI can express it headless (flags checked in each tool's docs). */
export type ProviderMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/**
 * Codex exec is read-only unless told otherwise (developers.openai.com/codex/noninteractive): plan/default keep that,
 * accept-edits and bypass allow edits in the workspace — never `danger-full-access`. OpenCode run's `--auto`
 * auto-approves what is not explicitly denied (opencode.ai/docs/cli): only on bypass. Gemini gets no
 * flag (not verified): they keep their own defaults and the environment's generated settings.
 */
export function modeArgs(id: ProviderId, mode: string = "default"): string[] {
  if (id === "codex") return ["--sandbox", mode === "acceptEdits" || mode === "bypassPermissions" ? "workspace-write" : "read-only"];
  if (id === "opencode" && mode === "bypassPermissions") return ["--auto"];
  return [];
}

/**
 * Shared shape validator for model values (and non-agent choices) that reach a CLI spawn: provider/model ids
 * such as `opencode/mimo-v2.6-pro` or `gpt-5:mini`, and display names such as `Gemini 3.5 Flash (Medium)`.
 * Starts with a letter or digit, ≤ 200 chars, no shell metacharacters (no quotes, `$`, backticks, `;`, `&`,
 * `|`, `<`, `>` or newlines) — `:` stays allowed because codex uses `gpt-5:mini` and it is not a metacharacter.
 * Exported so sendBody.ts can reuse the same bound at the HTTP layer. Agent names stay on AGENT_RE below.
 */
export const CHOICE_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()/+:,@-]{0,199}$/;

/** Agent/profile/extension names: a strict subset of CHOICE_RE (no spaces, no `:` or `/`). */
const AGENT_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Headless argv per CLI provider, prompt as ONE argument (verified where possible: opencode run, codex exec, gemini -p). */
function headlessArgs(id: ProviderId, prompt: string, opts?: { model?: string; agent?: string; mode?: string }): string[] {
  if (id === "opencode") {
    return [
      "run",
      ...modeArgs(id, opts?.mode),
      ...(opts?.model ? ["--model", opts.model] : []),
      ...(opts?.agent ? ["--agent", opts.agent] : []),
      prompt,
    ];
  }
  // `codex exec -m <id> --profile <name> "…"`
  if (id === "codex") {
    return [
      "exec",
      ...modeArgs(id, opts?.mode),
      ...(opts?.model ? ["--model", opts.model] : []),
      ...(opts?.agent ? ["--profile", opts.agent] : []),
      prompt,
    ];
  }
  // `gemini -p "…" [--model <id>] [--extensions <name>]`
  if (id === "gemini") {
    return [
      "-p",
      prompt,
      ...(opts?.model ? ["--model", opts.model] : []),
      ...(opts?.agent ? ["--extensions", opts.agent] : []),
    ];
  }
  throw httpError(502, `Provider ${id} runs through the Claude SDK, not a headless CLI`);
}

/**
 * Runs a CLI provider headless in `cwd`. stdout is the answer text (trimmed). Throws httpError(502, …)
 * on a non-zero exit (with a trimmed stderr/stdout tail, docker.ts style) or empty output; a killed
 * process (our own timeout) is a 504, same as docker. claude is not handled here — it is the SDK path.
 * `model`/`agent` are optional CLI selection flags (opencode --model/--agent, codex --model/--profile,
 * gemini --model/--extensions); both are shape-validated before spawning.
 */
export async function askWithProvider(
  id: ProviderId,
  prompt: string,
  opts: { cwd: string; timeoutMs?: number; model?: string; agent?: string; mode?: string; signal?: AbortSignal },
): Promise<AskResult> {
  const meta = providerById(id);
  if (!meta) throw httpError(502, `Unknown provider: ${id}`);
  if (meta.kind !== "cli") throw httpError(502, `Provider ${id} runs through the Claude SDK, not a headless CLI`);
  if (opts.model !== undefined && !CHOICE_RE.test(opts.model)) throw httpError(400, "Invalid model");
  if (opts.agent !== undefined && !AGENT_RE.test(opts.agent)) throw httpError(400, "Invalid agent");
  const cli = resolveCli(meta.binaries, process.platform, providerExec.find);
  if (!cli) throw httpError(502, `${meta.label} is not installed (or not on PATH)`);
  if (prompt.length > MAX_PROMPT_ARG) throw httpError(413, `The prompt is longer than ${MAX_PROMPT_ARG} characters for ${meta.label}`);
  const argv = headlessArgs(id, prompt, opts);
  if (cli.viaCmd && argv.some((a) => CMD_META.test(a))) {
    throw httpError(502, `${meta.label} is installed through a launcher that is not npm's: its prompt cannot be passed safely on Windows. Reinstall it with npm.`);
  }
  const timeout = opts.timeoutMs ?? 120_000;
  try {
    // The signal kills the CLI when the user stops the turn: it must not keep editing after Stop.
    const out = await providerExec.run(cli.cmd, [...cli.pre, ...argv], { timeout, cwd: opts.cwd, ...(opts.signal ? { signal: opts.signal } : {}) });
    const text = (out.stdout ?? "").trim();
    if (!text) throw httpError(502, `${meta.label} returned no output`);
    return { text, raw: out.stdout ?? "" };
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) throw e; // our own httpError above passes through
    const err = e as { stderr?: string; stdout?: string; killed?: boolean; message?: string; name?: string };
    if (opts.signal?.aborted || err.name === "AbortError") throw httpError(499, `${meta.label} was stopped`);
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

// ---- provider choices (agent/model lists for the Composer) ------------------------------------
const choicesCache = new Map<string, { at: number; agents: string[]; models: string[] }>();
const CHOICES_TTL = 60_000;
const AGENT_LINE = /^(\S+)\s+\([^)]+\)\s*$/; // "build (primary)" → "build"
const PROFILE_RE = /^[A-Za-z0-9._-]{1,100}$/; // a codex profile that can reach --profile
const LEGACY_PROFILE = /^\s*\[profiles\.([A-Za-z0-9_-]+)\]\s*$/gm; // codex < 0.134: [profiles.<name>] tables
const BULLET = /^[-*•]\s+/; // list bullets in CLI output
const TABLE_EDGE = /^\|\s*/; // markdown table edge
// Colour codes CLIs print even when stdout is not a tty: ESC [ … letter.
const ANSI = new RegExp("\\x1b\\[[0-9;?]*[A-Za-z]", "g");

/** Empties the choices cache; tests call this between runs. */
export function clearChoicesCache(): void {
  choicesCache.clear();
}

/**
 * Turns one CLI's stdout into names: strip colour codes and list/table decoration, then keep only short,
 * plain, name-shaped lines — log lines (`14:32:11 INFO …: …`), sentences (`No extensions installed.`),
 * column tables and long paths all drop out. A trailing ` (role)` suffix is removed on agent lists, the
 * shape `opencode agent list` prints. Anything suspicious degrades away instead of being
 * guessed at: a missing name is an empty list, not a wrong one.
 */
function parseNames(stdout: string | undefined, isAgent: boolean): string[] {
  const out: string[] = [];
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const line = raw.replace(ANSI, "").trim().replace(BULLET, "").replace(TABLE_EDGE, "").trim();
    if (!line || !/^[A-Za-z0-9]/.test(line)) continue; // empty or still decorated (table borders, ellipses)
    if (line.length > 80 || line.includes(":") || line.endsWith(".")) continue; // prose, logs, URLs
    if (/\s{2,}/.test(line)) continue; // table columns, not a name
    const name = isAgent ? (AGENT_LINE.exec(line)?.[1] ?? line) : line;
    if (isAgent ? AGENT_RE.test(name) : CHOICE_RE.test(name)) out.push(name);
  }
  return out;
}

/** `opencode agent list` + `opencode models`, spawned in the project cwd. */
async function opencodeChoices(cwd: string): Promise<{ agents: string[]; models: string[] }> {
  const cli = resolveCli(["opencode"], process.platform, providerExec.find);
  if (!cli) return { agents: [], models: [] };
  const [agentsOut, modelsOut] = await Promise.all([
    providerExec.run(cli.cmd, [...cli.pre, "agent", "list"], { timeout: 15_000, cwd }),
    providerExec.run(cli.cmd, [...cli.pre, "models"], { timeout: 15_000, cwd }),
  ]);
  return { agents: parseNames(agentsOut.stdout, true), models: parseNames(modelsOut.stdout, false) };
}

/**
 * Codex profiles from a filesystem scan of `$CODEX_HOME` (default `~/.codex`): `<name>.config.toml` files,
 * plus the legacy `[profiles.<name>]` tables inside `config.toml` (codex < 0.134). Nothing is spawned, so
 * a missing directory is simply an empty list. Models are not listed (codex has no list-models command),
 * so the model input stays free text.
 */
function codexProfiles(): { agents: string[]; models: string[] } {
  const home = process.env.CODEX_HOME?.trim() || pathJoin(homedir(), ".codex");
  const names = new Set<string>();
  let entries: string[] = [];
  try {
    entries = readdirSync(home);
  } catch {
    entries = [];
  }
  for (const file of entries) {
    if (!file.endsWith(".config.toml")) continue; // config.toml itself is not a profile
    const profile = file.slice(0, -".config.toml".length);
    if (PROFILE_RE.test(profile)) names.add(profile);
  }
  try {
    for (const m of readFileSync(pathJoin(home, "config.toml"), "utf8").matchAll(LEGACY_PROFILE)) names.add(m[1]);
  } catch {
    // no config.toml: only the per-profile files above count
  }
  return { agents: [...names].sort(), models: [] };
}

/** `gemini -l` lists the installed extensions (usable as `--extensions <name>`); there is no model list. */
async function geminiChoices(cwd: string): Promise<{ agents: string[]; models: string[] }> {
  const cli = resolveCli(["gemini"], process.platform, providerExec.find);
  if (!cli) return { agents: [], models: [] };
  const out = await providerExec.run(cli.cmd, [...cli.pre, "-l"], { timeout: 15_000, cwd });
  return { agents: parseNames(out.stdout, true), models: [] };
}

/**
 * Agent and model lists for one provider in a project cwd: opencode (agent list + models), codex (a
 * $CODEX_HOME profile scan) and gemini (`gemini -l` extensions);
 * claude and unknown ids answer empty without spawning. Failures also answer empty — never throw. A
 * successful non-empty list is cached 60 s per id+cwd; empty and failed answers are not cached, so a CLI
 * that was cold the first time is retried instead of staying empty.
 */
export async function listProviderChoices(id: ProviderId, cwd: string): Promise<{ agents: string[]; models: string[] }> {
  const key = `${id}\0${cwd}`;
  const hit = choicesCache.get(key);
  if (hit && Date.now() - hit.at < CHOICES_TTL) return { agents: [...hit.agents], models: [...hit.models] };
  const empty = { agents: [], models: [] };
  try {
    const result =
      id === "opencode" ? await opencodeChoices(cwd)
      : id === "codex" ? codexProfiles()
      : id === "gemini" ? await geminiChoices(cwd)
      : empty;
    if (result.agents.length || result.models.length) choicesCache.set(key, { at: Date.now(), ...result });
    return result;
  } catch {
    return empty;
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
  const base = { id: meta.id, label: meta.label, kind: meta.kind, install, loginHint: meta.loginHint, supports: meta.supports };
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

/**
 * A provider agent-os may run: the bundled SDK always (its sessions carry the OS's own guards), a CLI only when
 * the environment enabled it (`environment.config.json` → `tools`), because only then does `nexo update` generate
 * that CLI's permission files from library/permissions.json. A CLI enabled only in providers.json would run
 * without Nexo's rules.
 */
export const isGoverned = (id: ProviderId, tools?: Record<string, boolean>): boolean => id === "claude" || tools?.[id] === true;

/** The ids of every provider agent-os may run in this environment (isGoverned), in registry order. */
export const governedIds = (tools?: Record<string, boolean>): ProviderId[] => PROVIDERS.map((p) => p.id).filter((id) => isGoverned(id, tools));

/** Missing file (or nothing valid in it): seed from the CLI's tools map; no overlap falls back to claude. */
function seedFromTools(tools?: Record<string, boolean>): ProvidersFile {
  const enabled = Object.entries(tools ?? {})
    .filter(([, on]) => on)
    .map(([k]) => k)
    .filter(isProviderId);
  if (!enabled.length) return { enabled: ["claude"], default: "claude" };
  return { enabled, default: enabled[0] ?? null };
}

/**
 * Reads providers.json; unknown ids, and CLIs the environment's `tools` does not enable (isGoverned), are dropped,
 * and the default falls back to the first enabled provider.
 */
export function readProvidersFile(file: string, tools?: Record<string, boolean>): ProvidersFile {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return seedFromTools(tools);
  }
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const listed = Array.isArray(obj.enabled) ? obj.enabled.filter(isProviderId) : [];
  const enabled = [...new Set(listed)].filter((id) => isGoverned(id, tools));
  if (!enabled.length) return seedFromTools(tools);
  const def = isProviderId(obj.default) && enabled.includes(obj.default) ? obj.default : (enabled[0] ?? null);
  return { enabled, default: def };
}

/** Writes providers.json (pretty JSON + newline, atomic, parent dirs created); default stays inside enabled. */
export function writeProvidersFile(file: string, value: ProvidersFile): void {
  const enabled = [...new Set(value.enabled.filter(isProviderId))];
  const def = value.default && enabled.includes(value.default) ? value.default : (enabled[0] ?? null);
  writeJson(file, { enabled, default: def });
}
