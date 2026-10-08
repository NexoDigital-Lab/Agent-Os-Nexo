---
title: Escribir un módulo
summary: Todo lo que un módulo puede usar: manifiesto, contexto de servidor, slots, contribuciones a sesiones, librería del host.
order: 2
---

# Escribir un módulo

Todo lo que un módulo puede usar, con el archivo que lo define. Las reglas que tiene que seguir están en
[module-rules.md](module-rules.md); cómo encajan las piezas en ejecución está en [architecture.md](architecture.md).

## 1. El módulo más chico

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

Reiniciá la vista previa (`nexo os preview`) y el módulo aparece; `node scripts/check-modules.ts --module
hello` no tiene que informar nada. El código y las claves van en inglés (R8); el español vive en `messages.ts`.

## 2. Manifiesto (`module.json`)

Esquema: [`schema/module.schema.json`](../../schema/module.schema.json). Campos: `name` (= carpeta),
`version` (semver, R11), `description`, `owner` (`nexo` | `user`), `dependsOn` (ids de módulos, los
submódulos como `editor/terminal`), `core` (no se puede apagar; solo el núcleo de Nexo), `entry.server`,
`entry.web`, `nav` (solo módulos de primer nivel: `label`, el nombre de un `icon` de lucide, `order`).

El orden de carga es primero las dependencias; un ciclo o una dependencia desconocida hace que el módulo no
cargue (el problema se imprime al arrancar). El estado prendido/apagado del usuario vive en `os/data/modules.json`.

## 3. Lado servidor

`server/index.ts` exporta un `ModuleServer`: `(ctx: ModuleContext) => void | Promise<void>`
([`host/server/module-api.ts`](../../host/server/module-api.ts)).

| `ctx.` | Qué es |
|---|---|
| `id` | `"hello"`, o `"editor/lsp"` para un submódulo |
| `env` | Las carpetas del entorno: `root`, `library`, `projects`, `blueprints`, `os`, `data`, `state` |
| `api` | Router de Express montado en `/api`; registrá rutas completas (`/hello`, no `/api/hello`) |
| `dataDir` | `os/data/<id>` — persistente, ya existe |
| `stateDir` | `.state/os/<id>` — regenerable, ya existe |
| `server`, `port` | Para upgrades de WebSocket (chequeá `sameOrigin(req, port)` primero) |
| `dev`, `version` | Si corre desde el source (vista previa) o un build, y qué versión |

Helpers en [`host/server/http.ts`](../../host/server/http.ts): `h(fn)` envuelve un handler (lo que devuelve →
JSON, un `httpError` lanzado → status + `{ error }`), `httpError(status, message)`, `ok`,
`readJson(file, fallback)`, `run` (`execFile` con promesas), `trash(path)`, `sameOrigin`, `userBinPath()`,
`findBin(name)`, `loginShell(script)`. [`redact.ts`](../../host/server/redact.ts): `redact(text)` enmascara secretos.

Código de servidor compartido de otros módulos (importá solo lo que tu `dependsOn` permite, M2):

| Desde | Qué |
|---|---|
| `projects/server/projects.ts` | `projectDir(id)`, `projectPath(id)` (su `code/`), `projectIds()`, `worktreePath(id, wt)` |
| `projects/server/repo.ts` | `safePath(root, rel)`, `repoFiles(root)` |
| `projects/server/hooks.ts` | `addProjectHooks({ deleteFacts, beforeLocalDelete, afterLocalDelete })` |
| `sessions/server/index.ts` | `tabOf(req)` → `{ id, cwd, dir, project, worktree, meta }` para rutas `/tabs/:id/…` (404 si no existe) |
| `sessions/server/agent.ts` | `openTab`, `closeTab`, `setTabMeta(id, key, value)`, `tabContext(id)`, `emitTo(id, ev)`, `onTabClose(fn)` |
| `sessions/server/contributions.ts` | `contributeToSessions({...})` (abajo) |
| `sessions/server/claude.ts` | `ask(prompt, system, cwd)`, `structured(prompt, cwd, schema)` — llamadas sueltas a un agente; `ask` sigue el proveedor activo, `structured` necesita Claude en esta versión |
| `editor/submodules/terminal/server/terminal.ts` | `addShellProvider`, `createTerm`, `listTerms`, `killTerm`, `shellFor` |

### Participar en las sesiones de IA — `contributeToSessions`

[`sessions/server/contributions.ts`](../../modules/sessions/server/contributions.ts). Cada hook recibe la
pestaña (`TabContext`: `id`, `title`, `project` —`""` si no tiene—, `dir`, `cwd`, `worktree`, `meta`).

| Hook | Para qué | Ejemplo |
|---|---|---|
| `promptNote(tab)` | Una línea en el prompt de sistema del próximo turno de la pestaña | architecture, docker |
| `env(tab)` | Variables de entorno para el proceso del agente | docker (`CLAUDE_ENV_FILE`) |
| `mcpServers(tab, { emit, signal })` | Herramientas MCP en proceso para este turno | ssh |
| `autoAllow(tab, tool)` | Herramientas que nunca preguntan porque se protegen solas | ssh |
| `hooks` | Hooks del SDK para toda sesión (se combinan) | la guardia PreToolUse de ssh |
| `onMessage`, `onTurnEnd`, `onClose` | Observar turnos y el cierre de la pestaña | monitor, home, ssh |

**Eventos de módulo:** para poner algo en el chat de una pestaña, emití
`{ kind: "module", module: "<id>", type: "<qué>", id, waiting?, data }` (con `emit` o `emitTo`). Emitilo de
nuevo con el mismo `id` para actualizarlo; `waiting: true` marca la pestaña como "te necesita" hasta un
evento con `waiting: false`. El lado web lo muestra con el slot `chat.events`.

**Meta de la pestaña:** los datos por módulo que tienen que sobrevivir a un reinicio van en la `meta` de la
pestaña (`setTabMeta(id, "archOff", true)`); llegan a cada contribución y al `Tab` del lado web.

## 4. Lado web

`web/index.tsx` exporta `defineModule({ root?, views?, slots?, messages?, setup? })`
([`host/web/src/registry.ts`](../../host/web/src/registry.ts)):

- `views`: vistas del riel `{ id, label, icon, order, component, useBadge? }`.
- `slots`: ítems para slots que renderizan otros módulos, `{ "tab.views": [ … ] }` — tipá cada ítem con la
  interfaz del dueño y `satisfies`.
- `messages: { es }`: traducciones (M4).
- `setup()`: corre una vez antes del primer render (por ejemplo, aplicar el tema guardado).

Helpers del registro: `slot<T>(name)` (ítems de los módulos activos, en orden de carga), `views()`,
`isActive(id)`. Navegación (`shell/web/nav.ts`): `goTo(viewId)`, `notify(text)`.

### Slots

| Slot | Dueño (tipos en) | Ítem | Dónde se ve |
|---|---|---|---|
| `settings.sections` | shell (`shell/web/slots.ts`) | `{ id, label, order, component }` | Vista Ajustes |
| `rail.footer` | shell | `{ id, order, component }` | Abajo del riel |
| `shell.banners` | shell | `{ id, component }` | Arriba de la vista activa |
| `shell.overlays` | shell | `{ id, component }` | Siempre montado (diálogos, observadores) |
| `tab.views` | sessions (`sessions/web/slots.ts`) | `{ id, label, icon, order, component(TabViewProps), when? }` | Selector de vistas de una pestaña |
| `tab.side` | sessions | `{ id, label, order, component(SidePanelProps), useBadge?, when? }` | Columna derecha del chat |
| `tab.sideReplace` | sessions | `{ id, when, component, chatOnly?, label? }` | Reemplaza la columna derecha |
| `tab.overlay` | sessions | `{ id, component(TabViewProps & { view }) }` | Flota sobre las vistas de una pestaña |
| `chat.events` | sessions | `{ module, type, component({ tab, ev }) }` | Eventos de módulo en el chat |
| `composer.actions` | sessions | `{ id, label, icon, workMode?, primary?, run(props, prompt) }` | Al lado de Enviar |
| `tab.badges` | sessions | `{ id, component({ tab }) }` | Sobre una pestaña en la barra de pestañas |
| `terminal.bar` | editor/terminal (`…/terminal/web/slots.ts`) | `{ id, component({ tab, onChanged, onTerm }) }` | Arriba de la vista Terminal |

`TabViewProps` = `{ tab, go(view), draft(text), handoff }`. `handoff` pasa trabajo entre vistas de una
pestaña: quien envía hace `give(key, value)` y cambia de vista, quien recibe hace `take(key)`.

Código web compartido: el bus del editor (`editor/web/bus.ts`: `openInEditor(view, path, line)`,
`usePanelHeight(tabId)`), el store de pestañas (`sessions/web/tabs/store.ts`: `openTab`, `focusTab`,
`refreshTabs`, `draftTo`), el store de proyectos (`projects/web/store.ts`: `useProjects`), el tema
(`themes/web/theme.ts`: `usePalette`, `onPaletteChange`, `monacoTheme`, `xtermTheme`).

### Librería del host (`@os/…`)

| Import | Qué |
|---|---|
| `@os/lib/http` | `call<T>(method, url, body?)`, `seg(id)` (codifica el id de un proyecto para la URL), `isLocked(e)`, `hostApi` |
| `@os/i18n` | `t(key, vars)`, `language()`, `locale()` |
| `@os/lib/ConfirmDelete` | Botón de borrado en dos pasos |
| `@os/lib/ConfirmButton` | Cualquier acción que necesita un segundo clic (`confirmText` dice qué va a hacer) |
| `@os/lib/dialog` | `askText(mensaje, inicial)`, `askConfirm(mensaje, textoConfirmar)` — promesas; el shell monta el diálogo |
| `@os/lib/markdown` | `renderMarkdown(src)` (sanitizado) |
| `@os/lib/storage` | `readLS`, `writeLS`, `readStr`, `writeStr` (comodidades por navegador) |
| `@os/lib/images` | `prepareImage(blob)` — achica la imagen antes de subirla |
| `@os/lib/format`, `@os/lib/icons`, `@os/lib/ui` | Formatos, íconos de archivos, helpers chicos de interfaz |

### Estilos

Clases del host (`host/web/src/styles/base.css`): `.page`, `.card`, `.btn` (`primary`, `ghost`, `danger`,
`armed`, `sm`), `.field`, `.pill` (`ok`, `bad`, `info`, `accent`), `.seg`, `.modal` / `.modal-bg`,
`.errline`, `.faint`, `.muted`, `.empty`, `.spin`, `.eyebrow`, `.mono`, `.linkish`. Tokens del tema: M3 en
[module-rules.md](module-rules.md).

### Texto

El inglés es la clave: `t("Delete {name}?", { name })`. El `web/messages.ts` del módulo tiene el español.
Para una palabra que necesita otra traducción acá que en otro lado, agregá un contexto:
`t("Stop::container")` (en inglés se ve "Stop").

## 5. Tests

Archivos de `node:test` en `test/` (los corre `npm test` junto con los de todos los módulos). La lógica de
servidor se prueba directo; para lo que necesita un servidor corriendo, levantá uno en un puerto libre
contra un entorno temporal (`nexo init <tmp> --yes`).
