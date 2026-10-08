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

## Living next to other frameworks

Other agent frameworks (a company's, a community's) write into the same files Nexo generates. Nexo records what it
wrote in `.state/nexo/generated.json` and replaces only that: your own and other frameworks' lines in
`.claude/CLAUDE.md`, MCP servers in `.mcp.json`, `opencode.json` and `.gemini/settings.json`, and hooks in
`.claude/settings.json` stay. Permissions are the exception: they always come from `permissions.json` alone, so no
framework can widen them.

`nexo framework` installs and manages them in `frameworks/<name>/framework.json`:

- Sources: `npm:<pkg>@<exact version>` (installed with `--ignore-scripts`; ranges and `latest` are refused) and
  `path:<dir>` (managed by someone else: only referenced, never copied, modified or updated; `remove` forgets it).
- Enabled everywhere or per project (`--project <id>`); several at once.
- Contributions come from the framework's own `framework.json` (`contributes`) or are detected from the Claude Code
  plugin layout: `skills/*/SKILL.md`, `agents/*.md`, `commands/*.md`, `hooks/hooks.json`, `.mcp.json`, `CLAUDE.md`.
- They land next to Nexo's: local MCP servers in every AI's config, agents and commands in `.claude/agents/` and
  `.claude/commands/` (marked as generated, removed when disabled), instructions as an extra `@` line after
  `@../AGENTS.md`, skills through a generated folder of links (`.state/nexo/skills/`) that `.claude/skills` points at
  while a framework contributes skills (nothing is written into `library/skills`; a real `skills/` folder you made
  is left alone). A name that is already taken gets the framework's name as prefix.
- Hooks run a command on every tool call, so they stay off until you review them and run
  `nexo framework enable <name> --hooks`. `nexo doctor` lists frameworks as third-party and reports name clashes and
  hooks waiting for approval.

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
