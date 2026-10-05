---
title: Module rules
summary: The standard every module follows: M rules checked by the machine, R rules checked in review.
order: 3
---

# Module rules

The standard every agent-os module follows — Nexo's own, a contributor's, or the ones a user adds to their
personal copy. A review cites these rules by ID ("R4: writes JSON without tmp + rename") so whoever fixes
it knows what is wrong and what right looks like. How to run a review: [review.md](review.md).

- **M rules** are mechanical: `node scripts/check-modules.ts` (or `nexo os check` in an environment)
  finds every violation, and `test/module-rules.test.ts` keeps this repository at zero.
- **R rules** need judgment: the reviewer checks them by reading the code.

Severity, used in every review report:

| Severity | Means | Examples |
|---|---|---|
| **blocker** | Must be fixed before merging or building | security hole, data loss, breaks another module, any M finding |
| **major** | A bug or a gap that will bite | unvalidated input, missing error state, inaccessible control, logic without a test |
| **minor** | Quality | naming, comments, a token that could be reused, docs wording |

---

## M rules (checked by the machine)

### M1 — Valid manifest
`module.json` follows `schema/module.schema.json`: `name` equals the folder, semver `version`, a real
`description`, an `owner` (`nexo` or `user`), entries that point to existing files. Only top-level modules
have `nav`. A submodule never lists its parent in `dependsOn` (it is implicit).
**Fix:** correct the manifest; the checker message names the field.

### M2 — Imports only from what you declare
A module imports code only from: itself, the host (`@os/*`, `host/`), the modules in its `dependsOn`
(and theirs), its parent (submodules) and its own submodules. Type-only imports count too: they break
the build when that module is removed.
**Why:** a disabled module's routes are not mounted; code that reaches it anyway fails at runtime.
**Fix:** add the module to `dependsOn` if the dependency is real; otherwise move the shared code to the
host (`host/web/src/lib/`, `host/server/`) or reach it through a slot / contribution (see
[module-api.md](module-api.md)). A parent that renders a submodule's component must check
`isActive("<parent>/<sub>")` first (R6).

### M3 — Colors come from the theme
No `#hex`, `rgb()`, `rgba()`, `hsl()` in a module's CSS or TSX (except the `themes` module). Use the
tokens: `--bg`, `--bg-2`, `--panel`, `--panel-2`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`,
`--accent`, `--accent-ink`, `--accent-text`, `--accent-dim`, `--ok(-dim)`, `--bad(-dim)`, `--info(-dim)`,
`--warn`, `--violet`, `--add`, `--del`, `--brand`, `--shadow`, `--scrim`; for tints,
`color-mix(in srgb, var(--accent) 20%, transparent)`.
**Why:** users pick one of eight palettes, one of them light; a fixed color is wrong in at least one.
**Fix:** replace it with the token that means the same thing; if none fits, add one to the themes module
for every palette (and to `host/web/src/styles/base.css` for the first paint).

### M4 — Every UI text is translated
Each literal `t("…")` in a module's web code has its Spanish in `web/messages.ts` of the module or of a
module it depends on (or the host's), and `web/index.tsx` registers it with `messages: { es }`.
**Why:** English is the key; a missing entry shows English to a Spanish user.
**Fix:** add the entry to the module's `web/messages.ts`.

### M5 — One meaning per key
All dictionaries share one namespace. If two modules translate the same key differently, one of them is
wrong on screen. **Fix:** give the less general use a context: `t("All::containers")` shows "All" in
English and looks up `"All::containers"` in Spanish. Contexts are a trailing `::lowercase-word`.

### M6 — No browser dialogs
No `alert()`, `prompt()` or `confirm()` in a module's web code. They block the page, can't be styled or
translated, and the desktop app's webview may not show them.
**Fix:** `askText` / `askConfirm` from `@os/lib/dialog` (a promise), or `ConfirmButton` / `ConfirmDelete`
for an action that needs a second click.

---

## R rules (checked in review)

### R1 — Layout of a module
```
modules/<name>/
├── module.json
├── server/index.ts     default export register(ctx) — only when there is server code
├── server/*.ts         logic, one concern per file
├── web/index.tsx       default export defineModule({...}) — only when there is UI
├── web/api.ts          the typed client: export const <name>Api = { … }, types via `import type` from ../server
├── web/messages.ts     export const es: Record<string, string>
├── web/<name>.css      imported once, from web/index.tsx
├── web/slots.ts        only if the module owns slots: their item interfaces
├── test/*.test.ts      node:test
└── submodules/<sub>/   same shape
```
Every file starts with a comment saying what it is for and anything non-obvious about it.

### R2 — Names and routes
English, kebab-case module names; files `camelCase.ts` for logic and `PascalCase.tsx` for components.
Routes live under the module's own prefix: `/api/<module>/…`, or for something about a tab or a project
`/api/tabs/:id/<module>…` and `/api/projects/:id/<module>…`. Never add routes under another module's prefix.
CSS classes carry a short module prefix (`dk-` docker, `ssh-`, `arch-`, `vb-`) so modules never collide.

### R3 — Server code
- Handlers go through `h()` from `host/server/http.ts`; errors are `httpError(status, "English message")`
  with the right status (400 bad input, 404 unknown, 409 conflict, 413 too big, 5xx only for our faults).
- **Validate every input** at the route: type, length, enum, number range. Never trust the body, params
  or query, not even from our own UI — an agent's Bash can call the API too.
- File paths from a request go through `safePath(root, rel)` (`modules/projects/server/repo.ts`).
- Processes run with `execFile`/`spawn` and an argument list, never a shell string built from input.
- Long work streams or reports progress; nothing blocks the event loop on large input.
- `register` stays fast: no network calls, no heavy scans at startup.

### R4 — Where data lives
| Data | Place |
|---|---|
| The user's data for this module | `ctx.dataDir` (`os/data/<id>`) — never touched by builds |
| Regenerable data (caches, indexes, logs, shims) | `ctx.stateDir` (`.state/os/<id>`) |
| Knowledge about a project (features, architecture) | the project's `context/` |
| The project's code | `code/` — only when changing the code is the feature itself, and the UI says so |

JSON is written atomically (write a temp file, then `rename`). Secrets never go to `os/data` in clear
text (see the ssh vault) and never to logs.

### R5 — Extend, don't edit
A module never changes another module's files to plug itself in. It uses the extension points:
slots (web), `contributeToSessions` (AI sessions), `addProjectHooks` (project deletion),
`addShellProvider` (terminals), tab `meta` (`setTabMeta`). When a new extension point is needed, it is
added to the **owner** module, typed in its `slots.ts` / contribution interface, and documented in
[module-api.md](module-api.md) in the same change.

### R6 — Submodules
A submodule belongs to its parent (it depends on it implicitly and goes down with it). A parent may
render a submodule's components, but only behind `isActive("<parent>/<sub>")`, and must work with every
submodule off. Prefer a slot the parent owns when the submodule only adds something.

### R7 — UI
- Reuse the host's building blocks before inventing: `.page`, `.card`, `.btn` (`primary`, `ghost`,
  `danger`, `sm`), `.field`, `.pill` (`ok`, `bad`, `info`, `accent`), `.seg`, `.modal`, `.errline`,
  `.faint`, `.empty`, `.spin`; `ConfirmDelete`, `renderMarkdown`, `readLS`/`writeLS` from `@os/lib`.
- Views use the full width: no `max-width` on `.page`, cards or text; only form controls keep a width.
- Fonts through `var(--sans)`, `var(--display)`, `var(--mono)`.
- Every view has its loading, empty and error states.
- Accessibility: icon-only buttons have `aria-label` (and `title`); dialogs have `role="dialog"`,
  `aria-modal`, a label, a focus trap and Escape; errors use `role="alert"`; toggles use `aria-pressed`
  or `role="switch"`.
- Destructive actions use `ConfirmDelete` (click twice), never `window.confirm`.
- Polling: 3 s or slower, stopped on unmount, and a slow response for a previous item never overwrites
  the current one.

### R8 — Text
- English in code, comments and keys; the user's language comes from `messages.ts`.
- Every visible string goes through `t()`, including `title`, `aria-label` and `placeholder`.
- Variables go in placeholders (`t("Delete {name}?", { name })`), never by gluing translated pieces
  together; word order differs between languages.
- Server error messages are English; the UI passes them through `t()` when it shows them.

### R9 — Agents and security
- Tools a module gives agents (MCP servers in `contributeToSessions`) gate themselves: they check the
  user's permission for that tab and refuse clearly; `autoAllow` only for tools that gate themselves.
- Prompt notes are short and only for tabs where they apply.
- Nothing an agent can call reaches credentials; text that goes to an agent from a server or a console is
  passed through `redact` (`host/server/redact.ts`).
- One server, one port: no new listeners. WebSocket upgrades check `sameOrigin` before anything else.
- See [security.md](security.md).

### R10 — Tests
Server logic with branches (validation, parsing, policies, state machines) has `node:test` tests in
`test/`. Every bug fixed gets a regression test. `npm run check` passes before every commit.

### R11 — Versions and docs
From the module's first published release on, bump its `version` with every change (until then it stays
`1.0.0`): patch for a fix, minor for a feature, major when you
change a slot or contract other modules use. Keep the module's entry in [modules.md](modules.md)
(purpose, routes, slots, data) and its manifest `description` true, in both languages
(`docs/en/` and `docs/es/`).

### R12 — TypeScript
`strict`, no `any` except at a validated boundary, no non-null `!` where a check is cheap. Node runs the
server's TypeScript directly (type stripping), so no `enum`, `namespace` or constructor parameter
properties (`erasableSyntaxOnly`). Imports of server types into web code are `import type`.
