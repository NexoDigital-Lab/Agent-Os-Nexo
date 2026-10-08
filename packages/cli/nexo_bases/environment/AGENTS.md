# AGENTS.md — Nexo environment

You are working inside a **Nexo environment**: a structured workspace shared by every AI tool the
user runs. This file is the single source of rules. Read it fully; read everything else on demand.

## Map — where things live

| Path | What | Read it when |
|---|---|---|
| `environment.config.json` | Nexo version, enabled AIs, folder registry, OS summary | You need a path or the platform |
| `library/index.json` | Index of everything in `library/` | **Always first**, before opening anything in `library/` |
| `library/conventions/<topic>/` | How the user wants things done (git, naming, testing…) | Only the topic of the current task |
| `library/dictionary/` | The user's domain terms and names | A term is unclear |
| `library/commands/` | Commands with known output | Before exploring by hand |
| `library/memory/` | What you learned about the user | Start of a task, via its index |
| `library/skills/`, `library/agents/`, `library/hooks/` | Methods, subagents, hooks | Listed in `library/index.json` |
| `library/connections/` | MCP and service connections | A task needs an external service |
| `library/profile.json` | Identity and preferences; `skills`: the ones turned off or pinned | Commits, model choice, language, picking skills |
| `library/permissions.json` | What you may do alone | Before any write, command or connection call |
| `blueprints/` | Reusable setups (`index.json` first) | Setting up something already solved before |
| `projects/<name>/` | Projects: `AGENTS.md`, `code/`, `context/`, `secrets/` | Working on that project |
| `os/` | agent-os-nexo: `source/`, `versions/`, `data/` | The user asks to change agent-os-nexo |
| `.state/` | Generated logs, indexes, cache | Never edit by hand |

## Loading rule

Context is expensive. Open the index of an area, then only the files the task needs. Example: to
commit, read `library/conventions/git/` — not every convention.

## Invariants

1. **Evidence before claims.** Never say something is done, fixed or passing without running the
   check in this turn and reading its output.
2. **Options when there is more than one way.** Present them briefly with when to pick each and
   your recommendation; let the user choose.
3. **Respect `permissions.json`.** `allow` = do it; `ask` = ask first; `deny` = never. A project's
   `context/permissions.json` overrides the global file. Never edit permission files without
   asking; once the user agrees, change them with `nexo permissions` (validated, refreshes every AI's files).
4. **Confirm before anything irreversible or remote**: deleting, force operations, pushing,
   publishing, production systems, sending messages.
5. **Keep code clean.** Never add work conventions, AGENTS/CLAUDE files or notes inside
   `projects/*/code/`. Project rules go in `projects/<name>/AGENTS.md`; everything for the AI goes in
   `context/`.
6. **Answer in the user's language**, even though these rules are in English.
7. **Never print or copy secrets** from `connections/` or `secrets/` into chat, logs or commits.
8. **Commits** follow `library/conventions/git/` and use the identity in `library/profile.json`. Do
   not push or open PRs unless permissions allow it.
9. **Subagents** never exceed the model ceiling in `library/profile.json`.
10. **Read a project's index before exploring it**: `projects/<name>/context/map/README.md` (parts, stack,
   entry points, services, API, how the parts talk), then only the detail file the task needs. Missing or
   stale (`nexo map --check`) → `nexo map <name>`; never re-explore what the index already says.

## What you maintain on your own

- `library/memory/` — corrections, preferences and facts about the user that hold across projects.
  One fact per file, listed in `library/memory/index.json`. Update instead of duplicating.
- `library/conventions/` and `library/dictionary/` — when something is confirmed repeatedly, record
  it there.
- `projects/<name>/context/` — specs, decisions, features and state of that project.

**Ask first** before creating or changing skills, agents, hooks or commands.

## Methods (factory skills)

| Skill | Use it to |
|---|---|
| `nexo-features` (alias `CT`) | Turn a request into a feature in `context/features/` |
| `nexo-dev` | Build a feature or fix a bug end to end (`nexo-budget` sizes it) |
| `nexo-quick` | A small, clear change: ≤3 files, no risk signal |
| `nexo-infra` | How a project runs and builds, kept in `context/infra.md` |
| `nexo-idea` | Turn an idea into an options document, without deciding |
| `nexo-research` | Research a topic with sources |
| `nexo-debug` | Find a root cause before fixing |
| `nexo-blueprint` | Save something hard to set up as a reusable blueprint |
| `nexo-onboard` | Fill a new project's `AGENTS.md` and `context/` |
| `nexo-module-review` | Review an agent-os-nexo module against its rules and say what to fix |

After finishing a feature that was hard to set up, **ask** whether to save it as a blueprint.

## CLI — prefer it over doing things by hand

`nexo clone <repo> [--ws <name>]`, `nexo new <name>`, `nexo map [project]` (code map), `nexo connect <service>`, `nexo doctor`,
`nexo analyze`, `nexo update`, `nexo os status|versions|preview|build`. If `nexo doctor` recommends `nexo analyze`,
tell the user; never run the analysis on your own.

## agent-os-nexo

- Change it only in `os/source/`. Show it with `nexo os preview` and stop it with
  `nexo os stop --preview`; build a new version (`nexo os build --notes "<what changed>"`) only after
  the user approves. Before building, `nexo os check` must report no findings.
- Never close or restart agent-os-nexo (plain `nexo os stop`/`start` only when the user asks). It detects
  new builds and asks the user to restart.
- Skip a skill the user turned off in `library/profile.json` (`skills.disabled`); always consider the
  pinned ones (`skills.pinned`).
- Versions: patch +1 per approved build; after `x.y.9` comes `x.(y+1).0`. Never change the major.
