---
title: Modules
summary: Every module: what it does, its dependencies, routes, slots and data.
order: 5
---

# Modules

Every module of agent-os-nexo: what it does, what it depends on, what it exposes and where it keeps data.
Routes are under `/api`. "Core" modules cannot be turned off. When a module changes, its entry here
changes in the same commit, in both languages (rule R11).

Data columns: **data** is `os/data/<id>/` (persistent), **state** is `.state/os/<id>/` (regenerable).

---

## shell — core
The app frame: the rail, the active view, Settings, notices and banners.
- **Depends on:** nothing.
- **Owns slots:** `settings.sections`, `rail.footer`, `shell.banners`, `shell.overlays` (`web/slots.ts`).
- **Provides:** the `root` component; the Settings view (language, zoom in the desktop app); `goTo` /
  `notify` (`web/nav.ts`); page zoom for the desktop app (`web/zoom.ts`).

## themes — core
Eight palettes (Nexo by default; Night, Amber, Aurora, Ocean, Synthwave, Nexo Light, High contrast) and
bundled fonts, applied as CSS tokens on `:root`; derives the Monaco, xterm and git-graph themes.
- **Depends on:** shell. **Contributes:** a view in the rail (Modules) (palette picker).
- **Stores:** the choice in `os/data/prefs.json` (`theme`) through the host, plus a browser cache for
  the first paint.

## modules — core
Turn modules on and off with dependency checks (takes effect on the next start); shows why a module
did not load.
- **Depends on:** shell. **Contributes:** a view in the rail (Modules). **Uses:** `GET/PUT /api/os/modules`.

## versions — core
Personal builds: lists them, pins the one to load, and announces a newer one.
- **Depends on:** shell. **Contributes:** a view in the rail (Modules), `shell.banners` ("New version detected").
- **Routes:** `GET /versions`, `PUT /versions/pin` (writes `os/current`).

## projects — core
Projects of the environment: list, create, clone, delete (code, folder, GitHub repository), worktrees,
and their features (`context/features/<slug>.md`).
- **Depends on:** shell. **Contributes:** `shell.overlays` (new / delete project dialogs).
- **Owns:** project hooks (`server/hooks.ts`: `addProjectHooks`).
- **Routes:** `GET/POST /projects`, `POST /projects/clone`, `GET /projects/:id/delete-check`,
  `POST /projects/:id/delete`, `GET /projects/:id/diff`, `GET/POST /projects/:id/features`,
  `GET/PATCH/DELETE /projects/:id/features/:slug`, `GET /github/repos`.
- **Shared server code:** `projects.ts` (paths of projects and worktrees), `repo.ts` (`safePath`,
  `repoFiles`), `vscode.ts`.

## sessions
AI session tabs: chat with the agent, its sub-agents, review of its changes, permissions, images,
recent sessions and resume, full-text search over past sessions, skills and their recommendation.
Sessions run through the AI provider chosen in Providers; Claude keeps the full SDK behavior (resume,
hooks, permissions), while the other providers run headless CLI turns in the project folder, without
resume or permission prompts.
- **Depends on:** shell, projects. **View:** Tabs, Skills.
- **Owns slots:** `tab.views`, `tab.side`, `tab.sideReplace`, `tab.overlay`, `chat.events`,
  `composer.actions`, `tab.badges` (`web/slots.ts`); owns `contributeToSessions`
  (`server/contributions.ts`).
- **Contributes:** `shell.overlays` (notifications); project hooks (closes a project's tabs before it is
  deleted).
- **Routes:** `GET/POST /tabs`, `PATCH/DELETE /tabs/:id`, `GET /tabs/:id/stream` (server-sent events),
  `POST /tabs/:id/send|interrupt|permission|quick|seen`, `POST /tabs/:id/tasks/:taskId/stop`,
  `GET /tabs/:id/diff`, `POST /tabs/:id/uploads`, `GET/DELETE /tabs/:id/uploads/:name`, `GET /sessions/history`,
  `POST /sessions/history/:id/resume`, `GET /sessions/search`, `GET /sessions/:id/around`, `GET /sessions/skills`,
  `PUT /sessions/skills/prefs` (in `library/profile.json`), `POST /sessions/skills/recommend`.
- **Stores:** data `tabs.json`; state `uploads/`, `search.db`.

## providers
Detects the AI CLIs installed on the machine (Claude, OpenCode, Codex, Antigravity/Google, Gemini CLI) and
lets the user enable providers and pick the default; new sessions and one-shot calls follow that choice. Each
CLI keeps its own login — the app never stores keys. It also answers the chat composer's agent and model
pickers for the providers that expose them, one source per provider:
- **OpenCode:** `opencode agent list` and `opencode models`, run in the project folder.
- **Codex:** a scan of `$CODEX_HOME` (default `~/.codex`) for `<name>.config.toml` profiles plus the legacy
  `[profiles.<name>]` tables inside `config.toml`. No CLI is spawned, so a missing folder is just an empty
  list; models stay free text (Codex has no list-models command).
- **Antigravity (Google):** `agy agents` and `agy models`. Its registry entry is agy-only: the legacy
  `gemini` binary belongs to the Gemini CLI provider, which lists extensions as agents with `gemini -l` and
  takes the model as free text.
Lists are cached 60 s per provider and project; empty or failed answers are never cached, and output that
looks like a log line, a sentence or a table degrades to an empty list instead of a wrong name.
- **Depends on:** projects (the choices run in the project folder). **View:** Providers.
- **Routes:** `GET /providers`, `POST /providers/enabled`, `POST /providers/test`, `GET /providers/choices`.
- **Stores:** `library/providers.json` (enabled providers + default; seeded from the environment's `tools`
  when the file is missing).

## home
Start page: projects, recent sessions, goals, an inbox and today's log.
- **Depends on:** shell, projects, sessions. **View:** Home. **Contributes:** a session contribution
  (logs each turn).
- **Routes:** `GET/PUT /home/:doc`, `POST /home/inbox`. **Stores:** data (goals, inbox, logs).

## editor
A full editor in each project tab: file tree, Monaco with palette-aware themes, search and replace,
a bottom panel with Problems and Run, editor settings, and the agent-os-nexo equivalents of VS Code
extensions.
- **Depends on:** themes, sessions, extensions. **Contributes:** `tab.views` (Editor).
- **Shared web code:** `web/bus.ts` (`openInEditor`, `usePanelHeight`).
- **Routes:** `GET/PUT /tabs/:id/file`, `GET /tabs/:id/files`, `GET /tabs/:id/image`,
  `POST /tabs/:id/fs|move|replace|open-editor`, `GET /tabs/:id/search`, `GET/PUT /tabs/:id/run`,
  `GET /tabs/:id/toolchains`, `GET /icons/manifest`, `/icons/svg/*`.
- **Submodules** (each can be turned off; the editor works without them):
  - **editor/terminal** — real terminals per tab that live on the server and reattach after a reload;
    the Terminal view. Owns `terminal.bar` and shell providers (`addShellProvider`). Routes
    `GET/POST /tabs/:id/terms`, `POST /tabs/:id/terms/:tid/input`, `DELETE /tabs/:id/terms/:tid`;
    WebSocket per terminal.
  - **editor/lsp** — language servers (gopls, pyright): completion, hover, definition, diagnostics.
    `GET /lsp/:lang/status`; WebSocket `/api/tabs/:id/lsp/:lang`.
  - **editor/scm** — Git: changes, commit, sync, branches, stash, conflicts, the commit graph (Git
    view), diff review. Routes under `/tabs/:id/scm/*` and `/tabs/:id/git/*`.
  - **editor/practice** — Practice mode: the agent plans steps with hints and checks the user's code.
    Contributes `composer.actions`. Routes `/tabs/:id/practice*`. Stores data (plans).
  - **editor/setup** — project setup assistant (template, toolchains, dependencies, `.env`,
    extensions, Run commands). Depends on extensions. Routes `/tabs/:id/setup*`.

## notes
Free notes per project that an agent turns into features; a board of the features read from
`context/features/`, and drafts to promote.
- **Depends on:** shell, projects, sessions. **View:** Notes.
- **Routes:** `GET/POST /notes`, `PUT/DELETE /notes/:id`, `POST /notes/analyze|accept`,
  `GET /notes/drafts`, `DELETE /notes/drafts/:id`, `POST /notes/drafts/promote`. **Stores:** data (notes, drafts).

## dictionary
Your concepts (clients, products, jargon), one file per term in `library/dictionary/`, so no agent asks twice
what a word means. Agents see every term with its summary in `library/index.json` and save new ones with
`nexo dict add` (factory skill `nexo-dictionary`). Reads and writes go through `nexo dict`, so the format and the
index are the same from here, an agent or a terminal.
- **Depends on:** shell, projects. **View:** Dictionary.
- **Routes:** `GET/POST /dictionary`, `GET/PUT/DELETE /dictionary/:term` (PUT may rename). **Stores:** library (dictionary/).

## permissions
What agents may do alone, in Settings → Agent permissions: the global rules (`library/permissions.json`) or a
project's own on top of them (`context/permissions.json`), as allow / ask / deny columns per area plus the single
decisions (default, building, restarting, the SSH vault). Every change goes through `nexo permissions` — validated,
written atomically — and every AI's files are regenerated, so it applies to the next action.
- **Depends on:** shell, projects. **Contributes:** `settings.sections`.
- **Routes:** `GET /permissions?project=`, `POST /permissions/rule`, `POST /permissions/setting`. **Stores:** library, project context.

## context
A project's context in its tab (Context view): AGENTS.md and every text document under `context/` — features,
specs, decisions, proposals, the code map — in a tree, with an editor, a Markdown preview, Ctrl+S, and one click to
open a document or the whole folder in VS Code. Only those two places (never `secrets/` or `code/`, no symlinks),
saves are atomic and refused when the file changed on disk meanwhile, and `context/permissions.json` is read-only
(Settings → Agent permissions edits it). The tab's agents get a one-line note pointing at the context.
- **Depends on:** projects, sessions. **Contributes:** `tab.views` (Context), a session prompt note.
- **Routes:** `GET /projects/:id/context`, `GET/PUT /projects/:id/context/file`, `POST /projects/:id/context/open`.
  **Stores:** the project's context/.

## docker
The engine's containers, images, logs and shells; and a mirror dev container per project whose tools
(python, node, go…) the tab's terminals and agent use first.
- **Depends on:** shell, projects, sessions, editor/terminal. **View:** Docker.
- **Contributes:** `terminal.bar` (dev container controls), a shell provider, a session contribution
  (`CLAUDE_ENV_FILE` + prompt note), project hooks (offer to remove the container).
- **Routes:** `GET /docker/info|containers|images|terms`, `POST /docker/containers/:id/:action`,
  `GET /docker/containers/:id/logs`, `DELETE /docker/images/:id`, `POST /docker/pull`,
  `POST /docker/terms`, `DELETE /docker/terms/:tid`, `GET/POST/DELETE /tabs/:id/devenv`,
  `POST /tabs/:id/devenv/install`.
- **Stores:** state `shims/<project>/` (shims, env file, container config).

## ssh
Saved SSH accesses in an encrypted vault, an SSH console per session tab, and tools the tab's agent can
use on the server only while the user shares the console, with one approved plan for any change.
- **Depends on:** shell, projects, sessions, editor/terminal. **View:** SSH.
- **Contributes:** `tab.sideReplace` (the console), `chat.events` (`ssh/plan`), `tab.badges`; a session
  contribution (MCP tools, PreToolUse guard for every session, turn and close cleanup).
- **Routes:** `GET /ssh/state`, `POST /ssh/setup|unlock|lock`, `GET/POST /ssh/hosts`,
  `PUT/DELETE /ssh/hosts/:id`, `POST /ssh/hosts/:id/open`, `GET /ssh/sessions/:tabId`,
  `POST /ssh/sessions/:tabId/connect|share`, `POST /ssh/plans/:planId`; WebSocket `/api/ssh/term/:tabId`.
  Everything but `/ssh/state`, `/setup` and `/unlock` needs the vault cookie.
- **Stores:** data `vault/vault.json` (AES-256-GCM); state `run/` (temporary key files).
  Design and threat model: `modules/ssh/CONTRACT.md`, [security.md](security.md).

## architecture
The project's defined architecture (a document and a folder plan with rules per folder), the floating
Architect that advises against the real code, and a note that makes each tab's agent follow it.
- **Depends on:** projects, sessions, editor. **Contributes:** `tab.views` (Architecture),
  `tab.overlay` (the Architect), a session contribution (prompt note unless the tab turned it off).
- **Routes:** `GET /architecture/:project`, `PUT /architecture/:project/doc|tree`,
  `POST /architecture/:project/import|advise|chat`,
  `DELETE /architecture/:project/chat`, `POST /tabs/:id/architecture`.
- **Stores:** the project's `context/architecture/` (`architecture.md`, `tree.json`, `advice.json`,
  `chat.json`); tab meta `archOff`.

## http
An HTTP client with collections, environments and curl / Postman import.
- **Depends on:** shell. **View:** HTTP client.
- **Routes:** `GET/PUT /http`, `POST /http/send`. **Stores:** data (collections, environments).

## monitor
Token use and estimated cost of every AI session, and the plan's usage limits in the rail.
- **Depends on:** shell, sessions. **View:** Monitor. **Contributes:** `rail.footer`, a session
  contribution (reads rate limits).
- **Routes:** `GET /limits`, `GET /usage/summary`, `GET /usage/sessions`.

## extensions
VS Code extensions per project (recommended by stack or by an agent, synced to `.vscode/extensions.json`)
and their agent-os-nexo editor equivalents.
- **Depends on:** shell, projects, sessions. **View:** Extensions.
- **Routes:** `GET /extensions`, `PUT /extensions/general`, `POST /extensions/install`,
  `GET/PUT /projects/:id/extensions`, `POST /projects/:id/extensions/sync|recommend`.

## visual-bugs
A gallery of screenshots of what looks wrong in agent-os-nexo, with notes, for an agent to read and fix.
- **Depends on:** shell. **View:** Visual bugs.
- **Routes:** `GET/POST /visual-bugs` (POST takes the raw image), `GET/PATCH/DELETE /visual-bugs/:name`.
  **Stores:** data (images + `index.json` of notes).

## docs
This documentation inside the app, in the app's language (English when a document has no translation yet):
an index, full-text search and a reader where links between documents open in place.
- **Depends on:** shell. **View:** Docs.
- **Routes:** `GET /docs?lang=`, `GET /docs/search?q=&lang=`, `GET /docs/:slug?lang=`.
- **Reads:** `docs/<lang>/*.md` of the running build (shipped with it); `src/core/docs.ts` parses them, and
  `npm run docs` regenerates `docs/README.md`, the index for reading outside the app.
