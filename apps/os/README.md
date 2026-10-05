# agent-os

The local app of a Nexo environment: projects, AI sessions as tabs, an IDE, notes and tickets,
Docker, SSH and more. It is built entirely from **modules**.

> Status: environment only. The module system core (discovery, dependencies, enable/disable, build
> versions) is in place; the existing agent-os features are being migrated as modules (see the map
> below).

## Modules

Every sector of agent-os is a module under `modules/<name>/`. A folder with a `module.json` is all
it takes for agent-os to see it (Odoo-style discovery). Modules can nest submodules with the same
shape — the editor is a module; its Monaco, LSP and terminal integrations are submodules.

```
modules/<name>/
├── module.json        manifest — schema/module.schema.json
├── server/            routes and server-side logic (entry: server/index.ts)
├── web/               views and components (entry: web/index.tsx)
├── test/
└── submodules/<sub>/  same shape; implicitly depends on its parent
```

```json
{
  "name": "editor",
  "version": "1.0.0",
  "description": "Code editor with file tree, tabs and panels",
  "owner": "nexo",
  "dependsOn": ["shell", "projects"],
  "entry": { "server": "server/index.ts", "web": "web/index.tsx" },
  "nav": { "label": "Editor", "icon": "code", "order": 30 }
}
```

Rules:

- `name` matches the folder; kebab-case; semver `version`, bumped by the module itself when it
  changes.
- Dependencies are explicit in `dependsOn`; the core (`src/core/modules.ts`) rejects unknown
  dependencies and cycles, and loads modules dependencies-first.
- `core: true` modules cannot be disabled. A module cannot be disabled while an active module
  depends on it; disabling a module takes its submodules down with it. The enabled/disabled state
  lives in the environment's `os/data/modules.json`, so builds never reset it.
- Documentation and business rules of a module live in the project's `context/` (for agent-os
  itself: `os/` in the environment), not next to the code.

## Versions

Each user has a personal version history starting at `1.0.0`, kept in the environment:

```
os/
├── source/      the user's editable copy
├── versions/    builds: 1.0.0, 1.0.1, …
├── current      optional pin (`nexo os use <x.y.z>`); otherwise the newest build loads
└── data/        notes, tickets, vault, modules.json — builds never touch it
```

1. The user asks for a change; the agent edits `os/source/` and shows a **browser preview**.
2. Only after approval, a new build goes to `os/versions/<next>` (`nexo os next`): patch +1 per
   build, `x.y.9` → `x.(y+1).0`. The major version is reserved for Nexo releases.
3. The running app notices the newer build (`newerBuild`) and shows "New version detected — restart
   to load it". Neither the agent nor the app restarts itself.
4. Any earlier build can be loaded again.

New Nexo releases update the base; a compare tool lets an agent merge chosen base features into the
user's personal version (e.g. personal `1.0.5` + new base features → `1.0.6`). Personal changes are
never uploaded; contributing means cloning this repo and opening a PR.

## Migration map

The previous agent-os is being migrated module by module, without losing features:

| Module | What it does | Submodules |
|---|---|---|
| shell (core) | Rail, tab bar, projects sidebar, usage meter | — |
| home | Project cards, goals, inbox, daily log | — |
| projects | Create, clone, delete, setup wizard and recipes, dev environment | setup, devenv |
| sessions | AI session tabs, chat, agents panel, recents, search, images, skill picker | chat, agents, history, search, uploads, skills |
| editor | Full IDE | files, monaco, lsp, terminal, problems, run, scm, search, settings, practice, review |
| notes | Notes, ticket board, proposals | board, proposals |
| docker | Containers, images, logs, mirror dev containers | — |
| ssh | Encrypted vault and shared console; agents never use it on their own | vault, policy |
| http | HTTP client with collections | — |
| architecture | Architecture assistant | — |
| monitor | Token usage and limits | — |
| extensions | Editor extensions | — |
| visual-bugs | Visual bug gallery | — |
| versions | Version manager, preview, restart notice, compare and merge | preview, notifier, compare |
| modules | Module manager: enable/disable with dependency checks | — |
