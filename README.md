# Agent-Os-Nexo

Nexo is a source-available Agent Development Environment (ADE): an npm package that installs a local,
structured environment where AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode…) work on your
projects with shared conventions, permissions, memory and tools — plus **agent-os-nexo**, a local app (browser or
desktop window) to drive it all. Free to use, study and modify for noncommercial purposes under the PolyForm
Noncommercial License 1.0.0 (see LICENSE). Contributions welcome.

> Status: early development (`0.x`). The CLI and the environment work end to end; agent-os-nexo has all its
> modules and is installed, built, updated and run through `nexo os`. Not yet published to npm: install
> from a checkout (`--from`).

## What gets installed

`npx @nexodigital/nexo init` creates one environment (default `~/environments`):

```
environments/
├── AGENTS.md                 global rules — the only visible markdown; every AI reads it
├── .claude/ .gemini/ …       one hidden folder per enabled AI, generated, pointing to AGENTS.md
├── environment.config.json   lean manifest: Nexo version, tools, folders, OS summary
├── library/                  everything that is yours: conventions, dictionary, commands, memory,
│                             skills, agents, hooks, connections, profile, permissions
├── blueprints/               reusable setups and advanced code bases (starts empty)
├── os/                       agent-os-nexo: source/ (yours, a git repo), versions/, runtime/, data/
├── projects/                 <name>/ or <name>-ws/<part>/ → code/ + context/ + secrets/ + worktrees/
└── .state/                   generated: logs, indexes, cache (safe to delete)
```

Factory content (default skills such as `nexo-dev`, hooks, commands, permission presets) ships in [`packages/cli/nexo_bases/`](packages/cli/nexo_bases) and is placed into `library/` on install. `nexo update` only replaces items marked `owner: nexo`; anything you mark `owner: user` is yours.

## CLI

| Command | What it does |
|---|---|
| `nexo init` | Create an environment (asks path, AIs, permission preset, profile, default skills — all, core or none — and whether to install agent-os-nexo) |
| `nexo update` | Refresh factory items (`owner: nexo`); `--factory all` adds the ones skipped at init |
| `nexo doctor` | Check structure and formats; recommends what to fix, never fixes on its own |
| `nexo analyze` | Analyze the OS and toolchains; summary into the config, detail into `.state/` |
| `nexo index` | Rebuild `library/index.json` |
| `nexo clone <repo> [--ws <name>]` | Clone a repo into `projects/` with its context ready and indexed |
| `nexo new <name> [--ws <name>]` | Same, for a new empty project |
| `nexo map [project] [--check]` | Index a project for agents in `context/map/`: overview, files, symbols, architecture, how its parts talk |
| `nexo connect <service>` | Add a connection (MCP) and regenerate each AI's config |
| `nexo os install\|build\|start\|preview\|stop\|open` | Install agent-os-nexo, build a version, run it, open it with its access link |
| `nexo os check\|update\|use\|versions` | Module rules, merge a new release into your version, pin a build |

## Repository layout

```
packages/cli/            the npm package: `nexo` CLI (TypeScript, zero runtime dependencies) + nexo_bases/
apps/os/                 agent-os-nexo: host + modules; its docs (English and Spanish) in apps/os/docs/
apps/desktop/            optional Tauri window for agent-os-nexo
docs/                    architecture and decisions
```

## Development

Requires Node 22.18+.

```
npm install
npm run check      # typecheck + tests
npm run coverage   # tests with coverage: each source file at 80% (branches 70%), or it fails; exclusions in AGENTS.md
```

See [AGENTS.md](AGENTS.md) for contributor and agent rules, and [docs/architecture.md](docs/architecture.md) for the design.
