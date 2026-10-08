# Every AI, not only Claude

`nexo update` (and every command that changes the library) writes each enabled AI's own files from `library/`.
`nexo import <tool>` goes the other way: it reads what you already set up in a tool and proposes it for the library.
What a tool cannot express is reported by `nexo doctor` as "not enforced by <tool>" — never dropped silently.

Formats checked against each tool's documentation on 2026-10-07 (links in `packages/cli/src/core/aitools.ts`).

| | Claude Code | OpenCode | Codex | Gemini CLI |
|---|---|---|---|---|
| Instructions | `.claude/CLAUDE.md` → `AGENTS.md` | reads `AGENTS.md` | reads `AGENTS.md` | `context.fileName: AGENTS.md` |
| Command rules | allow / ask / deny | allow / ask / deny (last match wins: stricter written last) | `.codex/rules/nexo.rules` prefix rules; a partial last word is widened for deny/ask, skipped for allow | allow only (`tools.allowed`); it asks for every other command |
| File rules | read / edit, per path | read / edit, per path (absolute) | none (its workspace-write sandbox applies) | none |
| Default decision | per rule | `*` | `approval_policy` (never `never`) | asks |
| MCP connections | `.mcp.json` | `opencode.json` `mcp` | `.codex/config.toml` `[mcp_servers.*]` | `mcpServers` |
| Skills | `.claude/skills` → `library/skills` | `.opencode/skills` → `library/skills` | — | — |
| Agents | `.claude/agents/` | `.opencode/agents/` (subagents) | — | — |
| Import | `~/.claude/settings.json`, `~/.claude.json` | `~/.config/opencode/opencode.json` | `~/.codex/config.toml`, `~/.codex/rules/` | `~/.gemini/settings.json` |

Notes:
- Codex applies a project's `.codex/` only once you trust the project in Codex.
- Gemini's project policies (`.gemini/policies`) are disabled upstream, so a project cannot deny a command to Gemini.
- A `.codex/config.toml` that nexo did not write is never overwritten; keys you add to `.gemini/settings.json` stay.
- `nexo init` offers the AIs it finds on your PATH (Claude when none is found).

## In agent-os-nexo's chat tabs

A tab talks to Claude through the bundled Agent SDK, or to OpenCode, Codex or Gemini by running their CLI headless
in the project folder (so the files above apply). Details: `apps/os/docs/en/security.md`.

- **Only governed CLIs run.** A CLI must be enabled in `environment.config.json` → `tools` — the switch that makes
  `nexo update` write its permission files. The Providers view, the API and every turn refuse any other.
- **The composer's mode becomes the CLI's own** (flags checked in each tool's docs on 2026-10-08):

  | Mode | Codex | OpenCode | Gemini CLI |
  |---|---|---|---|
  | plan / default | `--sandbox read-only` | — (its own rules) | plan: `--approval-mode plan`; default: — |
  | accept edits | `--sandbox workspace-write` | — | `--approval-mode auto_edit` |
  | bypass | `--sandbox workspace-write` (never `danger-full-access`) | `--auto` | `--approval-mode auto_edit` (never `yolo`) |

- **One-shot helpers** (notes, extension recommendations) use the SDK, read-only. The skill recommendation may use
  the tab's CLI only when it has a documented read-only mode (Codex, Gemini) and only in the project folder;
  OpenCode documents none for `opencode run`, so it keeps the SDK.
- **Not offered:** Antigravity (`agy`) — its CLI and flags are not documented.
