# agent-os

The local app of a Nexo environment: projects, AI sessions as tabs, an IDE, notes and features,
Docker, SSH and more. It is built entirely from **modules**.

Every feature of the previous agent-os now lives in a module; the app runs as one Node process on
`localhost` (4780, or 4781 for the preview of `os/source`).

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

## How modules talk to each other

A module never edits another one: it plugs into extension points the other module declares.

- **Web slots** (`slot<T>(name)` in `host/web/src/registry.ts`, types next to the owner in
  `web/slots.ts`):
  - shell: `settings.sections`, `rail.footer`, `shell.banners`, `shell.overlays`.
  - sessions: `tab.views` (Editor, Terminal, Git, Architecture), `tab.side`, `tab.sideReplace`
    (the SSH console), `tab.overlay` (the Architect), `chat.events` (renders `{ kind: "module" }`
    events such as SSH plans), `composer.actions`, `tab.badges`.
  - editor/terminal: `terminal.bar` (docker's dev container controls).
- **Session contributions** (`contributeToSessions` in `modules/sessions/server/contributions.ts`):
  prompt notes, environment variables, in-process MCP servers, auto-allowed tools, hooks, and
  `onMessage` / `onTurnEnd` / `onClose`. Per-module data that must survive restarts goes in the
  tab's `meta` (`setTabMeta`): `meta.ssh`, `meta.archOff`.
- **Project hooks** (`addProjectHooks` in `modules/projects/server/hooks.ts`): facts and steps when a
  project is deleted (docker offers to remove its dev container).
- **UI text**: English is the key; each module ships `web/messages.ts` with Spanish. All modules share
  one dictionary, so a word that needs different translations takes a context (`t("All::containers")`),
  and `test/messages.test.ts` fails on clashes.

## Modules today

| Module | What it does | Submodules |
|---|---|---|
| shell (core) | App frame: rail, views, Settings, notices and banners | — |
| themes (core) | Palettes (Nexo by default, 8 in total) and bundled fonts | — |
| modules (core) | Turn modules on and off, respecting dependencies | — |
| versions (core) | Personal builds: list, choose the one to load, newer-build notice | — |
| projects (core) | Projects: list, create, clone, delete, worktrees and their features | — |
| sessions | AI session tabs: chat, agents, review of changes, recents, search, skills | — |
| home | Start page: projects, recent sessions, goals, inbox, today's log | — |
| editor | Files, Monaco, search, panel with Problems and Run, settings, plugins | terminal, lsp, scm, practice, setup |
| notes | Free notes per project turned into features; board from `context/features` | — |
| docker | Containers, images, logs, shells; a mirror dev container per project | — |
| ssh | Encrypted vault, a console per tab, gated agent tools (share switch + one approved plan) | — |
| architecture | The project's architecture (doc + folder plan) in `context/architecture/`, the Architect | — |
| http | HTTP client with collections, environments, curl/Postman import | — |
| monitor | Token use and cost per session, plan usage in the rail | — |
| extensions | VS Code extensions per project and their editor equivalents | — |
| visual-bugs | Screenshots of what looks wrong, for an agent to fix | — |

Each module's `module.json` lists its dependencies; `nexo os` and the Modules view respect them.

## Versions

Each user has a personal version history starting at `1.0.0`, kept in the environment:

```
os/
├── source/              the user's editable copy (node_modules → runtime/<hash>)
├── versions/<x.y.z>/    builds: dist/web + the server code + build.json (node_modules → runtime/<hash>)
├── runtime/<hash>/      dependencies, installed once per dependency set and shared by every build
├── current              optional pin (`nexo os use <x.y.z>`); otherwise the newest build loads
└── data/                notes, prefs, vault, modules.json — builds never touch it
.state/os/               pid files and logs of the running app and preview
```

| Command | What it does |
|---|---|
| `nexo os install [--from <dir>]` | Copy agent-os into `os/source` (from npm, or a local checkout), install its runtime, build `1.0.0`. Also offered by `nexo init --os yes`. |
| `nexo os preview` | Run `os/source` with hot reload on 4781, to look at a change before building it |
| `nexo os build [--notes <text>]` | Build `os/source` into the next version (`scripts/build.ts`); a failed build leaves nothing |
| `nexo os start` / `stop` | Run the active build on 4780 in the background / stop it (and the preview) |
| `nexo os use <x.y.z\|latest>` | Pin a build, or go back to the newest |
| `nexo os status` / `versions` | What is installed and running |

1. The user asks for a change; the agent edits `os/source/` and shows it with `nexo os preview`.
2. Only after approval, `nexo os build`: patch +1 per build, `x.y.9` → `x.(y+1).0`. The major
   version is reserved for Nexo releases.
3. The running app notices the newer build and shows "New version detected — restart to load it".
   Neither the agent nor the app restarts itself.
4. Any earlier build can be loaded again with `nexo os use`.

Personal changes are never uploaded; contributing means cloning this repo and opening a PR.
