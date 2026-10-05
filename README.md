# Agent-Os-Nexo

Nexo is an open-source **Agent Development Environment (ADE)**: an npm package that installs a
local, structured environment where AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode…)
work on your projects with shared conventions, permissions, memory and tools — plus **agent-os**,
a local app to drive it all.

Free to use, study, modify and redistribute under the GNU GPLv3. Contributions welcome.

> Status: early development (`0.x`). The environment and the CLI come first; agent-os modules
> are being migrated next.

## What gets installed

`npx @nexodigital-lab/nexo init` creates one **environment** (default `~/environments`):

```
environments/
├── AGENTS.md                 global rules — the only visible markdown; every AI reads it
├── .claude/ .gemini/ …       one hidden folder per enabled AI, generated, pointing to AGENTS.md
├── environment.config.json   lean manifest: Nexo version, tools, folders, OS summary
├── library/                  everything that is yours: conventions, dictionary, commands, memory,
│                             skills, agents, hooks, connections, profile, permissions
├── blueprints/               reusable setups and advanced code bases (starts empty)
├── os/                       agent-os: source/, versions/, data/
├── projects/                 <name>/ or <name>-ws/<part>/ → code/ + context/ + secrets/
└── .state/                   generated: logs, indexes, cache (safe to delete)
```

Factory content (default skills such as `nexo-dev`, hooks, commands, permission presets) ships in
[`packages/cli/nexo_bases/`](packages/cli/nexo_bases) and is placed into `library/` on install.
`nexo update` only replaces items marked `owner: nexo`; anything you mark `owner: user` is yours.

## CLI

| Command | What it does |
|---|---|
| `nexo init` | Create an environment (asks path, AIs, permission preset, profile) |
| `nexo update` | Refresh factory items (`owner: nexo`) |
| `nexo doctor` | Check structure and formats; recommends what to fix, never fixes on its own |
| `nexo analyze` | Analyze the OS and toolchains; summary into the config, detail into `.state/` |
| `nexo clone <repo> [--ws <name>]` | Clone a repo into `projects/` with its context ready |
| `nexo new <name> [--ws <name>]` | Same, for a new empty project |
| `nexo connect <service>` | Add a connection (MCP) and regenerate each AI's config |
| `nexo os versions` / `nexo os use <x.y.z>` | List / switch agent-os versions |

## Repository layout

```
packages/cli/            the npm package: `nexo` CLI (TypeScript) + nexo_bases/
apps/os/                 agent-os (environment scaffold; modules land here)
docs/                    architecture and decisions
```

## Development

Requires Node 22.18+.

```
npm install
npm run check      # typecheck + tests
```

See [AGENTS.md](AGENTS.md) for contributor and agent rules, and
[docs/architecture.md](docs/architecture.md) for the design.
