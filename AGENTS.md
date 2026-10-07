# AGENTS.md — working on the Nexo repository

Rules for any AI agent (and human) contributing to this repo. This file is about building Nexo
itself; the environment that Nexo installs has its own template at
`packages/cli/nexo_bases/environment/AGENTS.md`.

## Layout

- `packages/cli/` — the `nexo` CLI (TypeScript, zero runtime dependencies) and `nexo_bases/`,
  the factory content copied into a user's environment.
- `apps/os/` — agent-os-nexo. Modular: every sector is a module under `apps/os/modules/<name>/` with a
  `module.json` manifest. Its documentation, in English and Spanish, is `apps/os/docs/` (index:
  `apps/os/docs/README.md`).
- `apps/desktop/` — the optional Tauri window for agent-os-nexo (not an npm workspace).
- `docs/` — architecture (`docs/architecture.md`) and decisions (`docs/decisions/`).

## Commands

- `npm install` once at the root (npm workspaces).
- `npm run check` — typecheck + tests. Must pass before every commit.
- `npm run coverage` — the tests under c8: every source file of the CLI and of agent-os-nexo's server needs 80% of
  lines, statements and functions and 70% of branches. CI fails below that. Excluded in `apps/os/.c8rc.json`, and
  nothing else: UI code (`web/`, `.tsx`), type-only files (`host/server/module-api.ts`, `modules/*/server/types.ts`)
  and `host/server/main.ts` (reads the command line and listens; everything else is `app.ts`, tested). A new
  exclusion needs its reason here.
- `node packages/cli/src/bin.ts <command>` runs the CLI from source (Node strips types natively).

## Rules

1. **English** for code, comments, docs and factory content (agent-os-nexo's own documentation also has a
   Spanish copy, kept in step: see below). Agents answer users in the language
   the user writes in.
2. **Nothing personal in the repo.** No names, emails, paths like `/home/<user>`, client rules or
   tokens. Personal data lives in the user's `library/`, never in `nexo_bases/`.
3. **Zero runtime dependencies in the CLI.** Use Node built-ins (`node:fs`, `node:util` `parseArgs`,
   `node:child_process`). Dev dependencies are fine.
4. **Deterministic work belongs in the CLI**, judgment in skills. If an agent would repeat the same
   steps every time, it should be a `nexo` command the agent calls.
5. **Factory content format** (validated by `nexo doctor`):
   - Skill: `skills/<name>/SKILL.md`, frontmatter `name`, `description`, `owner`, `version`; at most
     200 lines; long detail in `references/`.
   - Agent: `agents/<name>.md`, frontmatter `name`, `description`, `owner`, `version`, `model`,
     `tools`, `returns`.
   - Hook: `hooks/<name>.json` with `event`, `match`, `run`, `description`, `owner`.
   - Environment `AGENTS.md`: at most 120 lines.
6. **Names**: English, lowercase, kebab-case. Plural folders for collections of the same kind
   (`skills`, `projects`, `blueprints`), singular for areas and files (`library`, `os`).
7. **Versioning**: the major version is set only by repo maintainers.
8. **Tests**: every CLI command has tests in `packages/cli/test/` (`node:test`). Bugs get a
   regression test.

## agent-os-nexo modules

Any change to a module follows `apps/os/docs/en/module-rules.md` (M1–M6 checked by
`node apps/os/scripts/check-modules.ts`, R1–R12 in review). Reviewing a module or a contribution —
yours, a contributor's, or when someone asks — follows `apps/os/docs/en/review.md`: machine checks first,
then findings by rule, severity and file:line, each with its fix. A change to a module updates its entry
in `apps/os/docs/{en,es}/modules.md`; a change to any document updates both languages and the index
(`npm run docs -w apps/os`).

## Commits

- English, imperative, describing the actual change (`cli: add doctor format checks`).
- One logical change per commit.
