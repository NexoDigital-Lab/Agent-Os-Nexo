# Agent-Os-Nexo

Nexo is a source-available Agent Development Environment (ADE): an npm package that installs a local,
structured environment where AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode) work on your
projects with shared conventions, permissions, memory and tools — plus **agent-os-nexo**, a local app (browser or
desktop window) to drive it all. Free to use, study and modify for noncommercial purposes under the PolyForm
Noncommercial License 1.0.0 (see LICENSE). Contributions welcome.

> Status: early development (`0.x`). The CLI, the environment and agent-os-nexo work end to end and are tested on
> Linux, macOS and Windows in CI. **Not yet published to npm**: install from a checkout (below). How the packages
> are built and what publishing still needs: [docs/release.md](docs/release.md).

## Getting started (from a checkout)

Requires Node 22.18+ and git.

```bash
git clone https://github.com/NexoDigital-Lab/Agent-Os-Nexo.git && cd Agent-Os-Nexo
npm ci
node packages/cli/src/bin.ts init ~/environments --os yes --from apps/os   # asks a few questions
cd ~/environments
node <checkout>/packages/cli/src/bin.ts os start                           # agent-os-nexo on 127.0.0.1:4780
```

`init` asks where the environment lives, which AIs to enable, the permission preset (strict, normal, relaxed), your
name and email for commits, the language agents answer in, which factory items to install and whether to install
agent-os-nexo; every answer has a flag (`--yes` takes the defaults). Once published, the same is
`npx @nexodigital/nexo init`.

## What gets installed

```
environments/
├── AGENTS.md                 global rules — the only visible markdown; every AI reads it
├── .claude/ .gemini/ .codex/ generated per enabled AI from library/ (plus opencode.json, .mcp.json)
├── environment.config.json   lean manifest: Nexo version, enabled AIs (tools), folders, OS summary
├── library/                  everything that is yours: conventions, dictionary, commands, memory,
│                             skills, agents, hooks, connections, profile, permissions
├── blueprints/               reusable setups and advanced code bases (starts empty)
├── os/                       agent-os-nexo: source/ (yours, a git repo), versions/, runtime/, data/
├── projects/                 <name>/ or <name>-ws/<part>/ → code/ + context/ + secrets/ + worktrees/
└── .state/                   generated: logs, indexes, cache, access tokens (agents may not read it)
```

Factory content (default skills such as `nexo-dev`, agents, hooks, commands, permission presets) ships in
[`packages/cli/nexo_bases/`](packages/cli/nexo_bases) and is placed into `library/` on install. `nexo update` only
replaces items marked `owner: nexo`; anything you mark `owner: user` is yours.

## CLI

| Command | What it does |
|---|---|
| `nexo init [path]` | Create an environment (see Getting started) |
| `nexo update` | Refresh factory items (`owner: nexo`) and every AI's generated files; `--factory all` adds skipped items |
| `nexo doctor` | Check structure, formats and what each AI cannot enforce; never changes anything |
| `nexo analyze` | Record the OS and toolchains; summary into the config, detail into `.state/` |
| `nexo index` | Rebuild `library/index.json` |
| `nexo permissions [show]` · `allow\|ask\|deny\|remove\|set …` | Read or change one permission rule, validated; every AI's files follow |
| `nexo dict [list\|show\|add\|rm]` | Your dictionary of concepts in `library/dictionary/`, listed in the index for agents |
| `nexo memory [status]` · `install\|update\|remove` | Agent memory shared by every AI: [Engram](https://github.com/Gentleman-Programming/engram) (third party, MIT), pinned and hash-checked, reached only through Nexo's filtering proxy (`nexo memory mcp`); see `packages/cli/THIRD-PARTY.md` |
| `nexo framework add\|list\|remove\|enable\|disable\|default\|plugin` | Third-party agent frameworks in `frameworks/` (pinned npm or a `path:`), chosen per tab like an AI or set as the environment default; off until enabled, hooks off until approved |
| `nexo import <claude\|codex\|gemini\|opencode> [--apply]` | Bring another AI's MCP servers and permissions into the library; never weakens a rule |
| `nexo connect <name> --command <cmd>` | Add a connection (MCP) and regenerate each AI's config |
| `nexo clone <repo> [--ws <name>]` · `nexo new <name>` | Bring in a project (or start one) with its context ready and indexed |
| `nexo map [project] [--check]` | Index a project for agents in `context/map/`: files, symbols, architecture, routes |
| `nexo os install\|build\|start\|preview\|stop\|open` | Install agent-os-nexo, build a version, run it, open it with its access link |
| `nexo os check\|update\|use\|versions\|desktop` | Module rules, merge a new release, pin a build, download the desktop app |

## agent-os-nexo

Projects, AI sessions as tabs (Claude through the bundled SDK; OpenCode, Codex and Gemini through their own CLIs
when the environment enables them), a full editor, notes, the dictionary, permissions and context views, Docker,
SSH and more — each part a module. Docs in English and Spanish: [apps/os/docs](apps/os/docs/README.md).

## Repository layout

```
packages/cli/            the `nexo` CLI (TypeScript, zero runtime dependencies) + nexo_bases/ (factory content)
apps/os/                 agent-os-nexo: host + modules; its docs (English and Spanish) in apps/os/docs/
apps/desktop/            optional Tauri window for agent-os-nexo
docs/                    architecture, every-AI support, packages and releases, decisions
```

| Document | About |
|---|---|
| [docs/architecture.md](docs/architecture.md) | The environment, factory vs user content, agent-os-nexo's lifecycle |
| [docs/ai-tools.md](docs/ai-tools.md) | What each AI gets from the library, and how agent-os runs each one |
| [docs/release.md](docs/release.md) | The npm packages, the desktop installers, what publishing needs |
| [docs/decisions/](docs/decisions/README.md) | Design decisions, newest at the bottom |

## Development

```bash
npm ci
npm run check                                  # typecheck + every test
npm run coverage                               # each source file at 80% (branches 70%), or it fails
node apps/os/scripts/check-modules.ts          # agent-os module rules M1–M6
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # the desktop window
```

Changes go through a pull request; CI runs the checks on Linux, macOS and Windows (Node 22 and 24) and a real
install on each OS. See [AGENTS.md](AGENTS.md) for contributor and agent rules.
