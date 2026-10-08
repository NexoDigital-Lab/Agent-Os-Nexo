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
