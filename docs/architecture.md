# Architecture

Nexo is distributed as one npm package (`packages/cli`) that installs an **environment**: the live,
personal copy of Nexo on a machine. The repository is the template; the environment is where the
user works. One environment per installation; its path is chosen at `nexo init` (default
`~/environments`) and recorded in `environment.config.json`. More environments = more installs.

## Two kinds of content

| | Factory (`nexo_bases/`) | User (`library/`, `blueprints/`, `projects/`) |
|---|---|---|
| Lives in | the npm package / this repo | the environment only |
| Versioned by Nexo | yes | **no** — users may version it themselves |
| Updated by `nexo update` | yes, items with `owner: nexo` | never |

To customize a factory skill, copy it and set `owner: user`; updates then leave it alone.

## Environment layout

```
environments/
├── AGENTS.md                 single source of rules; ≤120 lines
├── .claude/                  CLAUDE.md ("@../AGENTS.md"), settings.json, skills, agents — one set per enabled AI:
├── .gemini/ .codex/          Gemini and Codex settings and rules; opencode.json + .opencode/ for OpenCode
│                             (Codex and OpenCode read AGENTS.md natively; see docs/ai-tools.md)
├── environment.config.json   lean: nexo{version,updatePolicy}, root, tools, folders, system summary
├── library/
│   ├── index.json            the only thing loaded up front: what exists and when to use it
│   ├── conventions/<topic>/  e.g. git/ — read only when the task needs that topic
│   ├── dictionary/           names and terms of the user's domain
│   ├── commands/             scripts/definitions with known output (cheaper than exploring)
│   ├── memory/               what the agent learns on its own
│   ├── skills/ agents/ hooks/
│   ├── connections/          MCP and service connections, credentials included (never versioned)
│   ├── profile.json          identity and preferences
│   └── permissions.json      global allow / ask / deny
├── frameworks/<name>/        third-party agent frameworks: framework.json (+ node_modules for npm ones); see docs/ai-tools.md
├── blueprints/<name>/        README.md, steps.md, files/, verify.md
├── os/                       agent-os-nexo (optional: `nexo init --os yes` or `nexo os install`)
│   ├── source/               the user's editable copy of agent-os-nexo
│   ├── versions/<x.y.z>/     builds; the newest (or the pin in `current`) is loaded at start
│   ├── runtime/<hash>/       dependencies shared by every build with the same set
│   └── data/                 prefs, notes, the SSH vault, modules.json — versions never touch it
├── projects/
│   ├── <name>/               single repo or monorepo
│   │   ├── AGENTS.md         project rules (next to code, never inside it)
│   │   ├── code/             the clone, untouched by work conventions
│   │   ├── context/          everything for the AI: business logic, specs, features (features/),
│   │   │                     the defined architecture (architecture/), the code index (map/,
│   │   │                     `nexo map`, written on clone), how it runs (infra.md), past runs (pipeline/), docs graph,
│   │   │                     permissions.json (overrides the global one)
│   │   ├── worktrees/<name>/ extra checkouts of code/ for parallel work
│   │   └── secrets/
│   └── <name>-ws/            project with several parts (repos)
│       ├── AGENTS.md
│       ├── context/          shared across parts
│       └── <part>/{AGENTS.md, code/, context/, secrets/}
└── .state/                   generated and disposable: logs, indexes, analysis detail, cache;
                              .state/os/ holds agent-os-nexo's pid files, logs, per-module caches and the
                              access token of each run — every permission preset denies agents reading it
```

## Principles

1. **AGENTS.md is the single source.** Each AI gets a generated pointer or setting, only for the AIs
   enabled in `environment.config.json`.
2. **Load little, on demand.** Every area has an index; an agent about to commit reads only
   `conventions/git/`.
3. **What is for the agent fills itself** (memory, conventions, dictionary). Skills, hooks and
   commands are added only after asking the user.
4. **Permissions are data.** `permissions.json` (global + per project) is translated by the CLI into
   each AI's native permission format; hooks cover what a tool cannot express.
5. **Deterministic steps are CLI commands**; agents call them instead of improvising.
6. **The OS analysis never runs on its own**: `nexo doctor` recommends `nexo analyze` when it has
   never run or is older than 7 days.

## agent-os-nexo

agent-os-nexo is a local app built from modules (see `apps/os/README.md`), distributed as its own npm
package (`@nexodigital/agent-os-nexo`) that `nexo os install` copies into `os/source` (from a checkout with
`--from` until it is published: `docs/release.md`). Each user has a
personal version history starting at `1.0.0`: a requested change is previewed in the browser
(`nexo os preview`), built only on approval (`nexo os build`), and loaded on the next restart (the
app detects the new build and asks to restart; agents never close it). Each run has its own access token (only the
browser holding its link, or the desktop app, can use it), and `nexo os check` keeps every module to the
rules in `apps/os/docs/en/module-rules.md`. Patch +1 per approved build, every 10 rolls the minor (`1.0.9` → `1.1.0`). The
major version is reserved for Nexo releases. Personal changes stay local; `os/source` is a git repository whose `base` branch holds
Nexo's releases, and `nexo os update` merges a new one into the user's version, keeping their changes
and stopping on real conflicts.

## Factory methodologies

| Command | Purpose |
|---|---|
| `nexo-features` (alias `CT`) | Create a feature in `context/features/`, optionally synced to a connection |
| `nexo-dev` | Build a feature or fix a bug: sized S/M/L, plan gate, result gate, work-mode dial |
| `nexo-idea` | Turn an idea into an options document, without deciding |
| `nexo-research` | Research a topic with sources |
| `nexo-debug` | Root cause first, then fix and a proving test |
| `nexo-quick` | The light lane: ≤3 files, no risk signal, verified, no plan or panel |
| `nexo-budget` | Size a nexo-dev run (risk signals, review set, model routing) and learn from it |
| `nexo-infra` | How a project runs and builds, in `context/infra.md` |
| `nexo-module-review` | Review an agent-os-nexo module against its rules |
