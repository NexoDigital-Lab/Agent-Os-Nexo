# Detected AI tools and models

A snapshot of what a `nexo` environment reports for one machine: which AI CLIs are present on
`PATH`, which of them Nexo governs, and which models each one actually resolves. It is the
evidence behind [ai-tools.md](ai-tools.md) decisions #20–#23, captured on **2026-10-17**.

Every number below was observed on a Windows machine, not assumed. Re-run the commands in
[Reproduce](#reproduce) to refresh it on another host; the counts change as the user's
subscription and free tiers change.

## What this is not

- **Not a default.** Nothing here writes a `model` into any tool's config. OpenCode and Gemini
  ship with no forced default model; Codex keeps the one its own subscription set.
- **Not a repository file.** Every config read here lives in the user's home folder
  (`~/.config/opencode/`, `~/.gemini/`, `~/.codex/`), never in this repository. A grep for model
  configs in `nexo_bases/` returns nothing.

## Tools on `PATH`

Only OpenCode and Gemini were on `PATH` for this machine. Nexo governs only the tools enabled in
`environment.config.json` → `tools` (decision #21), and here that list holds a single entry.

| Tool | On `PATH` | Enabled in `environment.config.json` | Notes |
|---|---|---|---|
| OpenCode | yes | no | CLI resolves; not governed by Nexo here |
| Gemini CLI | yes | no | CLI resolves; not governed by Nexo here |
| Claude Code | no | **yes** | the only tool Nexo governs on this host |
| Codex | no | no | not present |
| Antigravity (`agy`) | no | no | left out until its flags are documented (decision #22) |

`environment.config.json` (trimmed to the relevant block):

```json
"tools": {
  "claude": true,
  "codex": false,
  "gemini": false,
  "opencode": false
}
```

`nexo doctor --json` reports no model findings — only a stale OS analysis and a missing code
index, both unrelated to models.

## Models per tool

### OpenCode — 91 models across 4 providers

OpenCode resolves models from a subscription provider, a free tier, and any local runtimes the
user has running. All are available without an extra API key beyond the OpenCode session.

| Provider | Count | Kind | Examples |
|---|---|---|---|
| `opencode-go` | 29 | user's subscription | `mimo-v2.5`, `gpt-6-luna`, `gemini-4-argon-contributor`, free: `beam-free`, `longcat-2.5-preview-free` |
| `opencode` | 46 | free tier | `nemotron-3.5-super-vl-free`, `mimo-v2.6-flash-free`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free` |
| `lmstudio` | 11 | local runtime | `qwen3-coder-30b`, `openai/gpt-oss-20b` |
| `ollama` | 5 | local runtime | `qwen3.6`, `qwen2.5-coder:7b` |

Because the provider already exposes them, every one of the 91 is selectable in the TUI or via
`--model`; no config list is needed to make them available.

### Gemini CLI — 2 models resolve on this account

The model field in `~/.gemini/settings.json` is free text (decision: `providers.ts`), so the only
trustworthy check is to ask the account. With `gemini-api-key` auth:

| Requested model | Resolves to |
|---|---|
| `gemini-3.6-flash` | `gemini-3.6-flash` |
| `gemini-3.8-flash` | `gemini-3.6-flash` (auto-upgrade) |
| `gemini-3.6-pro` | not available on this account |
| `gemini-3.1-pro` | not available on this account |
| `gemini-4-argon` | not available on this account |

Older or newer flash names auto-upgrade to the newest flash model the account allows; the pro
and argon tiers do not resolve. Never invent a Gemini model name — the field accepts anything
and only the account knows what runs.

### Codex — already set by its own subscription

`~/.codex/config.toml` carries `model = "gpt-5.6-sol"`. Left untouched.

### Claude Code

Not inspected and never modified on this host, per the request that drove this snapshot.

## Reproduce

```sh
# Which AI CLIs are on PATH (the "detection" part)
for c in claude opencode codex gemini agy; do command -v "$c" || echo "$c -> not found"; done

# What Nexo governs (needs the environment root)
NEXO_ROOT=<environment-root> nexo doctor --json

# Model counts per OpenCode provider (run inside an OpenCode session)
# the models tool lists every provider and model the session can reach
```

For Gemini, ask the account directly rather than guessing names:

```sh
gemini -p "just: ok" --output-format json --model <candidate>
# read stats.models to see which model actually ran
```
