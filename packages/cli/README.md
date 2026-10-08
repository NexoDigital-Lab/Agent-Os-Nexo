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

Commands: `init`, `update`, `doctor`, `analyze`, `index`, `clone`, `new`, `map`, `connect`, `os`.
Run `nexo --help` for options.

What it writes for each enabled AI (next to every `AGENTS.md`):

| AI | Files |
|---|---|
| Claude Code | `.claude/CLAUDE.md` (`@../AGENTS.md`), `.claude/settings.json` (permissions + hooks), `.mcp.json` |
| Gemini CLI | `.gemini/settings.json` (`contextFileName: AGENTS.md`, MCP servers) |
| Codex, OpenCode | nothing — they read `AGENTS.md` natively |

Generated files may contain connection credentials; the environment is personal and is never
versioned by Nexo. Zero runtime dependencies; Node 22.18+. License: PolyForm Noncommercial 1.0.0 (see LICENSE).
