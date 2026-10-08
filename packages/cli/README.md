# @nexodigital/nexo

The `nexo` CLI installs and maintains a **Nexo environment**: a structured local workspace where AI
coding agents (Claude Code, Codex, Gemini CLI, OpenCode) share rules, permissions, memory, skills
and tools across your projects.

```
npx @nexodigital/nexo init          # create ~/environments (asks a few questions)
cd ~/environments
nexo analyze                            # record OS and toolchains
nexo clone git@github.com:you/app.git   # projects/app/{AGENTS.md, code/, context/, secrets/}
nexo doctor                             # check everything; never changes anything
nexo dict add "Active customer" --summary "Bought in the last 90 days"   # a concept every agent reads
nexo permissions allow commands "npm run test*"                         # one rule, validated, every AI updated
nexo os desktop                         # the desktop app installer for this OS (checksum-verified)
nexo import opencode --apply            # bring another AI's MCP servers and permissions into the library
```

Commands: `init`, `update`, `doctor`, `analyze`, `index`, `permissions`, `dict`, `import`, `connect`, `clone`,
`new`, `map`, `os`. Run `nexo --help` for options. Not on npm yet: until it is, run it from a checkout with
`node packages/cli/src/bin.ts` (see the repository README and `docs/release.md`).

What it writes for each enabled AI (next to every `AGENTS.md`), from `library/`:

| AI | Files |
|---|---|
| Claude Code | `.claude/CLAUDE.md` (`@../AGENTS.md`), `.claude/settings.json` (permissions + hooks), `.claude/skills` and `.claude/agents/`, `.mcp.json` |
| OpenCode | `opencode.json` (permissions, MCP servers), `.opencode/skills`, `.opencode/agents/`; reads `AGENTS.md` natively |
| Codex | `.codex/config.toml` (approval policy, sandbox, MCP servers), `.codex/rules/nexo.rules` (command rules); reads `AGENTS.md` natively |
| Gemini CLI | `.gemini/settings.json` (`AGENTS.md` as context file, allowed commands, MCP servers) |

What an AI cannot express (Codex has no per-path file rules, Gemini cannot deny a command…) is listed by
`nexo doctor`, never dropped silently: see `docs/ai-tools.md` in the repository.

Generated files may contain connection credentials; the environment is personal and is never
versioned by Nexo. Zero runtime dependencies; Node 22.18+. License: PolyForm Noncommercial 1.0.0 (see LICENSE).
