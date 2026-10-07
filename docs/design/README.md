# Design notes

The documents written while Nexo was being designed (2026-10-04), exported from the live design docs so
anyone on the team can read them. They are **history, in Spanish**: each one separates what was decided
in the design talk from proposals that were still open, and several open points were settled later.
What Nexo does today is described in [`../architecture.md`](../architecture.md), the decisions in
[`../decisions/`](../decisions/) and agent-os-nexo in [`../../apps/os/docs/`](../../apps/os/docs/README.md).
When a note and those documents disagree, those documents win.

| File | Topic |
|---|---|
| [00-propuesta.md](00-propuesta.md) | The overall proposal: every decision taken, environment layout, factory methodologies, diagnosis of v1 |
| [01-agents-md.md](01-agents-md.md) | `AGENTS.md` as the single source and the per-tool files (`.claude/`, `.gemini/`) |
| [02-environment-config.md](02-environment-config.md) | `environment.config.json`: what it stores and who writes each field |
| [03-library.md](03-library.md) | `library/`: conventions, dictionary, commands, memory |
| [04-blueprints.md](04-blueprints.md) | Reusable pieces across projects (first called `features/`, now `blueprints/`) |
| [05-os.md](05-os.md) | agent-os-nexo: personal versions, modules, map of modules from v1 |
| [06-projects.md](06-projects.md) | `projects/`: `<name>-ws/<part>/{code,context,secrets}` |
| [07-connections.md](07-connections.md) | Connections (MCP), first planned as `mcp/`, now `library/connections/` |
| [08-palettes.html](08-palettes.html) | Palette options for agent-os-nexo's themes module, with a live preview and measured WCAG contrast (open it in a browser) |

Interactive diagrams in the original docs are not exported; a line marks where each one was.
