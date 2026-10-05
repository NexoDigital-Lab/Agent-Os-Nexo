---
title: Writing a module
summary: Everything a module can use: manifest, server context, slots, session contributions, host library.
order: 2
---

# Writing a module

Everything a module can use, with the file that defines it. The rules a module must follow are in
[module-rules.md](module-rules.md); how the pieces fit at runtime is in [architecture.md](architecture.md).

## 1. The smallest module

```
modules/hello/
├── module.json
├── server/index.ts
├── web/index.tsx
├── web/api.ts
├── web/Hello.tsx
├── web/messages.ts
└── web/hello.css
```

```json
// module.json
{
  "name": "hello",
  "version": "1.0.0",
  "description": "Says hello and remembers how many times",
  "owner": "user",
  "dependsOn": ["shell"],
  "entry": { "server": "server/index.ts", "web": "web/index.tsx" },
  "nav": { "label": "Hello", "icon": "hand", "order": 95 }
}
```

```ts
// server/index.ts — hello: a counter kept in os/data/hello.
import { join } from "node:path";
import { h, httpError, readJson } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { renameSync, writeFileSync } from "node:fs";

const register: ModuleServer = (ctx) => {
  const file = join(ctx.dataDir, "count.json");
  ctx.api.get("/hello", h(() => readJson(file, { count: 0 })));
  ctx.api.post("/hello", h((req) => {
    const by = Number(req.body?.by ?? 1);
    if (!Number.isInteger(by) || by < 1 || by > 100) throw httpError(400, "by must be an integer from 1 to 100");
    const next = { count: readJson(file, { count: 0 }).count + by };
    writeFileSync(`${file}.tmp`, JSON.stringify(next));
    renameSync(`${file}.tmp`, file); // atomic (R4)
    return next;
  }));
};

export default register;
```

```ts
// web/api.ts
import { call } from "@os/lib/http";
export const helloApi = {
  get: () => call<{ count: number }>("GET", "/api/hello"),
  add: (by = 1) => call<{ count: number }>("POST", "/api/hello", { by }),
};
```

```tsx
// web/index.tsx — hello: a rail view with a counter.
import { Hand } from "lucide-react";
import { defineModule } from "@os/registry";
import { Hello } from "./Hello";
import { es } from "./messages";
import "./hello.css";

export default defineModule({
  views: [{ id: "hello", label: "Hello", icon: Hand, order: 95, component: Hello }],
  messages: { es },
});
```

```tsx
// web/Hello.tsx — the view: loading and error states, every text through t().
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { helloApi } from "./api";

export function Hello() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => void helloApi.get().then((r) => setCount(r.count), (e) => setError(e.message)), []);
  return (
    <div className="page">
      <h1>{t("Hello")}</h1>
      {error && <p className="errline" role="alert">{t(error)}</p>}
      {count === null ? <span className="spin" /> : <p className="hello-count">{t("Said {n} times", { n: count })}</p>}
      <button className="btn primary" onClick={() => helloApi.add().then((r) => setCount(r.count), (e) => setError(e.message))}>{t("Say it")}</button>
    </div>
  );
}
```

```ts
// web/messages.ts
export const es: Record<string, string> = { "Hello": "Hola", "Said {n} times": "Dicho {n} veces", "Say it": "Decilo" };
```

Restart the preview (`nexo os preview`) and the module is there; `node scripts/check-modules.ts --module
hello` must report nothing.

## 2. Manifest (`module.json`)

Schema: [`schema/module.schema.json`](../../schema/module.schema.json). Fields: `name` (= folder),
`version` (semver, R11), `description`, `owner` (`nexo` | `user`), `dependsOn` (module ids, submodules
as `editor/terminal`), `core` (cannot be turned off — Nexo's own core only), `entry.server`,
`entry.web`, `nav` (top-level modules only: `label`, a lucide `icon` name, `order`).

Load order is dependencies first; a cycle or an unknown dependency stops the module from loading (the
problem is printed at startup). The user's on/off state lives in `os/data/modules.json`.

## 3. Server side

`server/index.ts` exports a `ModuleServer`: `(ctx: ModuleContext) => void | Promise<void>`
([`host/server/module-api.ts`](../../host/server/module-api.ts)).

| `ctx.` | What it is |
|---|---|
| `id` | `"hello"`, or `"editor/lsp"` for a submodule |
| `env` | The environment's folders: `root`, `library`, `projects`, `blueprints`, `os`, `data`, `state` |
| `api` | Express router mounted at `/api`; register full paths (`/hello`, not `/api/hello`) |
| `dataDir` | `os/data/<id>` — persistent, exists already |
| `stateDir` | `.state/os/<id>` — regenerable, exists already |
| `server`, `port` | For WebSocket upgrades (check `sameOrigin(req, port)` first) |
| `dev`, `version` | Running from source (preview) or a build, and which version |

Helpers in [`host/server/http.ts`](../../host/server/http.ts): `h(fn)` wraps a handler (return value → JSON,
thrown `httpError` → status + `{ error }`), `httpError(status, message)`, `ok`, `readJson(file, fallback)`,
`run` (promisified `execFile`), `trash(path)`, `sameOrigin`, `userBinPath()`, `findBin(name)`,
`loginShell(script)`. [`redact.ts`](../../host/server/redact.ts): `redact(text)` masks secrets.

Shared server code of other modules (import only what your `dependsOn` allows, M2):

| From | What |
|---|---|
| `projects/server/projects.ts` | `projectDir(id)`, `projectPath(id)` (its `code/`), `projectIds()`, `worktreePath(id, wt)` |
| `projects/server/repo.ts` | `safePath(root, rel)`, `repoFiles(root)` |
| `projects/server/hooks.ts` | `addProjectHooks({ deleteFacts, beforeLocalDelete, afterLocalDelete })` |
| `sessions/server/index.ts` | `tabOf(req)` → `{ id, cwd, dir, project, worktree, meta }` for `/tabs/:id/…` routes (404 otherwise) |
| `sessions/server/agent.ts` | `openTab`, `closeTab`, `setTabMeta(id, key, value)`, `tabContext(id)`, `emitTo(id, ev)`, `onTabClose(fn)` |
| `sessions/server/contributions.ts` | `contributeToSessions({...})` (below) |
| `sessions/server/claude.ts` | `ask(prompt, system, cwd)`, `structured(prompt, cwd, schema)` — one-off agent calls |
| `editor/submodules/terminal/server/terminal.ts` | `addShellProvider`, `createTerm`, `listTerms`, `killTerm`, `shellFor` |

### Taking part in AI sessions — `contributeToSessions`

[`sessions/server/contributions.ts`](../../modules/sessions/server/contributions.ts). Each hook gets the tab
(`TabContext`: `id`, `title`, `project` — `""` without one —, `dir`, `cwd`, `worktree`, `meta`).

| Hook | Used for | Example |
|---|---|---|
| `promptNote(tab)` | A line in the system prompt of the tab's next turn | architecture, docker |
| `env(tab)` | Environment variables for the agent process | docker (`CLAUDE_ENV_FILE`) |
| `mcpServers(tab, { emit, signal })` | In-process MCP tools for this turn | ssh |
| `autoAllow(tab, tool)` | Tools that never prompt because they gate themselves | ssh |
| `hooks` | SDK hooks for every session (merged) | ssh's PreToolUse guard |
| `onMessage`, `onTurnEnd`, `onClose` | Observe turns and tab closing | monitor, home, ssh |

**Module events:** to put something in a tab's chat, emit
`{ kind: "module", module: "<id>", type: "<what>", id, waiting?, data }` (with `emit` or `emitTo`).
Emit it again with the same `id` to update it; `waiting: true` marks the tab "needs you" until an event
with `waiting: false`. The web side renders it through the `chat.events` slot.

**Tab meta:** per-module data that must survive restarts goes in the tab's `meta`
(`setTabMeta(id, "archOff", true)`); it reaches every contribution and the web `Tab`.

## 4. Web side

`web/index.tsx` exports `defineModule({ root?, views?, slots?, messages?, setup? })`
([`host/web/src/registry.ts`](../../host/web/src/registry.ts)):

- `views`: rail views `{ id, label, icon, order, component, useBadge? }`.
- `slots`: items for slots other modules render, `{ "tab.views": [ … ] }` — type each item with the
  owner's interface and `satisfies`.
- `messages: { es }`: translations (M4).
- `setup()`: runs once before the first render (e.g. apply the saved theme).

Registry helpers: `slot<T>(name)` (items of the active modules, in load order), `views()`,
`isActive(id)`. Navigation (`shell/web/nav.ts`): `goTo(viewId)`, `notify(text)`.

### Slots

| Slot | Owner (types in) | Item | Rendered |
|---|---|---|---|
| `settings.sections` | shell (`shell/web/slots.ts`) | `{ id, label, order, component }` | Settings view |
| `rail.footer` | shell | `{ id, order, component }` | Bottom of the rail |
| `shell.banners` | shell | `{ id, component }` | Above the active view |
| `shell.overlays` | shell | `{ id, component }` | Always mounted (dialogs, watchers) |
| `tab.views` | sessions (`sessions/web/slots.ts`) | `{ id, label, icon, order, component(TabViewProps), when? }` | View switcher of a tab |
| `tab.side` | sessions | `{ id, label, order, component(SidePanelProps), useBadge?, when? }` | Chat's right column |
| `tab.sideReplace` | sessions | `{ id, when, component, chatOnly?, label? }` | Replaces the right column |
| `tab.overlay` | sessions | `{ id, component(TabViewProps & { view }) }` | Floats over a tab's views |
| `chat.events` | sessions | `{ module, type, component({ tab, ev }) }` | Module events in the chat |
| `composer.actions` | sessions | `{ id, label, icon, workMode?, primary?, run(props, prompt) }` | Next to Send |
| `tab.badges` | sessions | `{ id, component({ tab }) }` | On a tab in the tab bar |
| `terminal.bar` | editor/terminal (`…/terminal/web/slots.ts`) | `{ id, component({ tab, onChanged, onTerm }) }` | Above the Terminal view |

`TabViewProps` = `{ tab, go(view), draft(text), handoff }`. `handoff` passes work between views of a
tab: the sender `give(key, value)` and switches view, the receiver `take(key)`.

Shared web code: the editor bus (`editor/web/bus.ts`: `openInEditor(view, path, line)`,
`usePanelHeight(tabId)`), the tab store (`sessions/web/tabs/store.ts`: `openTab`, `focusTab`,
`refreshTabs`, `draftTo`), the project store (`projects/web/store.ts`: `useProjects`), the theme
(`themes/web/theme.ts`: `usePalette`, `onPaletteChange`, `monacoTheme`, `xtermTheme`).

### Host library (`@os/…`)

| Import | What |
|---|---|
| `@os/lib/http` | `call<T>(method, url, body?)`, `seg(id)` (URL-encodes a project id), `isLocked(e)`, `hostApi` |
| `@os/i18n` | `t(key, vars)`, `language()`, `locale()` |
| `@os/lib/ConfirmDelete` | Two-step delete button |
| `@os/lib/ConfirmButton` | Any action that needs a second click (`confirmText` says what it will do) |
| `@os/lib/dialog` | `askText(message, initial)`, `askConfirm(message, confirmText)` — promises; the shell mounts the dialog |
| `@os/lib/markdown` | `renderMarkdown(src)` (sanitized) |
| `@os/lib/storage` | `readLS`, `writeLS`, `readStr`, `writeStr` (per-browser conveniences) |
| `@os/lib/images` | `prepareImage(blob)` — downscales before upload |
| `@os/lib/format`, `@os/lib/icons`, `@os/lib/ui` | Formatting, file icons, small UI helpers |

### Styling

Host classes (`host/web/src/styles/base.css`): `.page`, `.card`, `.btn` (`primary`, `ghost`, `danger`,
`armed`, `sm`), `.field`, `.pill` (`ok`, `bad`, `info`, `accent`), `.seg`, `.modal` / `.modal-bg`,
`.errline`, `.faint`, `.muted`, `.empty`, `.spin`, `.eyebrow`, `.mono`, `.linkish`. Theme tokens: M3 in
[module-rules.md](module-rules.md).

### Text

English is the key: `t("Delete {name}?", { name })`. The module's `web/messages.ts` has the Spanish.
For a word that needs a different translation here than elsewhere, add a context:
`t("Stop::container")` (English shows "Stop").

## 5. Tests

`node:test` files in `test/` (run by `npm test` with every other module's). Server logic is tested
directly; for what needs a running server, start one on a free port against a temporary environment
(`nexo init <tmp> --yes`).
