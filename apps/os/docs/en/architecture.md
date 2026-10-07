---
title: How agent-os-nexo works
summary: The server, the web app, where things live in an environment, and how modules cooperate.
order: 1
---

# How agent-os-nexo works

agent-os-nexo is one Node.js process that serves an HTTP API and a React app on `127.0.0.1`. Everything it
does — projects, AI session tabs, the editor, Docker, SSH… — comes from **modules**; the host only
discovers them, mounts them, and gives them a few shared services.

```
browser / desktop window ──HTTP + WebSocket──▶ host/server/main.ts (127.0.0.1:4780)
                                                 ├── guardRequest          same-origin + X-Agent-OS-Nexo header
                                                 ├── /api/os/*             host routes (info, modules, prefs)
                                                 ├── /api/…                each active module's register(ctx)
                                                 ├── WebSocket upgrades    terminals, LSP, SSH console
                                                 └── dist/web (a build) or Vite middleware (--dev, the preview)
```

## Where it runs

agent-os-nexo always runs inside a **Nexo environment** (the folder `nexo init` creates):

| Path | What agent-os-nexo keeps there |
|---|---|
| `os/source/` | The user's editable copy of agent-os-nexo (this package) |
| `os/versions/<x.y.z>/` | Builds: `dist/web` + the server code + `build.json` |
| `os/runtime/<hash>/` | Dependencies, shared by every build with the same set (`node_modules` of a build links here) |
| `os/data/` | Persistent: `prefs.json`, `modules.json`, and `os/data/<module>/` per module |
| `.state/os/` | Regenerable: `<module>/` caches, logs, pid files of `nexo os` |
| `projects/<id>/` | The projects: `code/`, `context/`, `worktrees/`, `AGENTS.md` |
| `library/` | Skills, agents, hooks, profile (`profile.json`) used by AI sessions |

The server finds the environment from `NEXO_ROOT`, or by walking up from its own folder until it finds
`environment.config.json` (`host/server/env.ts`).

## Boot, server side (`host/server/main.ts`)

1. Read the environment and the version (`build.json`, or `"source"` with `--dev`).
2. Discover modules: every `modules/<name>/module.json` and `modules/<name>/submodules/<sub>/module.json`
   (`src/core/modules.ts`). Invalid manifests, unknown dependencies and cycles are reported and skipped.
3. Decide which are active: core modules always; the rest unless turned off in `os/data/modules.json`;
   a module whose dependency is off is off too.
4. In dependency order, import each active module's `entry.server` and call `register(ctx)`. A module
   that fails to load is skipped with the modules that depend on it (`host/server/mount.ts`); the rest
   still start, and the Modules view shows the error.
5. Serve the web app: Vite in middleware mode with HMR on the same port (`--dev`), or `dist/web`.

Host routes: `GET /api/os/info` (version, newer build, environment, language), `GET/PUT /api/os/modules`
(list, turn on/off with dependency checks), `GET/PUT /api/os/prefs` (theme, language).

## Boot, web side (`host/web/src/main.tsx`)

1. Ask the server which modules are active and the user's prefs. Without this run's access cookie
   (`host/server/access.ts`) the API answers 401 and the page explains how to get in (`nexo os open`).
2. Import the `web/index.tsx` of each active module (`import.meta.glob` makes them all available to the
   bundle; only active ones are loaded), register their translations, run their `setup()`.
3. Render the `root` the shell module provides. The shell renders the rail from every module's `views`,
   and each slot from the items active modules contribute.

A turned-off module has neither routes nor UI. Code that depends on it must declare it (M2) or check
`isActive` (R6).

## How modules cooperate

Modules never reach into each other's internals; they use extension points the owner declares
([module-api.md](module-api.md)):

- **Slots** (web): the owner renders `slot<T>("name")`, others contribute items.
- **Session contributions** (server): prompt notes, env, MCP tools, hooks, turn observers.
- **Project hooks** (server): facts and steps when a project is deleted.
- **Shell providers** (server): which shell a project's terminal runs (docker's dev container).
- **Module events**: `{ kind: "module", module, type, id, waiting?, data }` in a tab's stream.
- **Tab meta**: per-module data on a tab that survives restarts.

## Language and look

English is the key of every UI text; `web/messages.ts` of each module adds Spanish (`host/web/src/i18n.ts`).
The themes module applies one of eight palettes as CSS custom properties on `:root`, and derives the
Monaco, xterm and git-graph themes from it; modules only use the tokens.

## Versions

A personal history per user: preview a change (`nexo os preview`), build it on approval (`nexo os build`),
and the running app shows "New version detected — restart to load it". Details in [lifecycle.md](lifecycle.md).

## Security

Local only, one port, same-origin checks, a vault for SSH credentials and a guard that keeps agents away
from them. Details in [security.md](security.md).
