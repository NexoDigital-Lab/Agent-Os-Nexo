---
title: Módulos
summary: Cada módulo: qué hace, sus dependencias, rutas, slots y datos.
order: 5
---

# Módulos

Todos los módulos de agent-os-nexo: qué hacen, de qué dependen, qué exponen y dónde guardan datos. Las rutas
están bajo `/api`. Los módulos "core" no se pueden apagar. Cuando un módulo cambia, su entrada acá cambia en
el mismo commit, en los dos idiomas (regla R11).

En los datos, **data** es `os/data/<id>/` (persistente) y **state** es `.state/os/<id>/` (regenerable).

---

## shell — core
El marco de la app: el riel, la vista activa, Ajustes, avisos y banners.
- **Depende de:** nada.
- **Dueño de los slots:** `settings.sections`, `rail.footer`, `shell.banners`, `shell.overlays` (`web/slots.ts`).
- **Provee:** el componente `root`; la vista Ajustes (idioma, zoom en la app de escritorio); `goTo` /
  `notify` (`web/nav.ts`); el zoom de página para la app de escritorio (`web/zoom.ts`).

## themes — core
Ocho paletas (Nexo por defecto; Night, Amber, Aurora, Ocean, Synthwave, Nexo Light, High contrast) y
tipografías incluidas, aplicadas como tokens CSS en `:root`; deriva los temas de Monaco, xterm y el grafo de git.
- **Depende de:** shell. **Aporta:** `settings.sections` (selector de paleta).
- **Guarda:** la elección en `os/data/prefs.json` (`theme`) a través del host, más una caché del navegador
  para el primer pintado.

## modules — core
Prender y apagar módulos con chequeo de dependencias (se aplica en el próximo arranque); muestra por qué
un módulo no cargó.
- **Depende de:** shell. **Aporta:** `settings.sections`. **Usa:** `GET/PUT /api/os/modules`.

## versions — core
Builds personales: los lista, fija cuál cargar y avisa cuando hay uno más nuevo.
- **Depende de:** shell. **Aporta:** `settings.sections`, `shell.banners` ("Nueva versión detectada").
- **Rutas:** `GET /versions`, `PUT /versions/pin` (escribe `os/current`).

## projects — core
Los proyectos del entorno: listar, crear, clonar, borrar (código, carpeta, repositorio de GitHub),
worktrees y sus features (`context/features/<slug>.md`).
- **Depende de:** shell. **Aporta:** `shell.overlays` (diálogos de proyecto nuevo / borrar proyecto).
- **Dueño de:** los hooks de proyectos (`server/hooks.ts`: `addProjectHooks`).
- **Rutas:** `GET/POST /projects`, `POST /projects/clone`, `GET /projects/:id/delete-check`,
  `POST /projects/:id/delete`, `GET /projects/:id/diff`, `GET/POST /projects/:id/features`,
  `GET/PATCH/DELETE /projects/:id/features/:slug`, `GET /github/repos`.
- **Código de servidor compartido:** `projects.ts` (rutas de proyectos y worktrees), `repo.ts` (`safePath`,
  `repoFiles`), `vscode.ts`.

## sessions
Pestañas de sesiones de IA: el chat con el agente, sus subagentes, la revisión de sus cambios, permisos,
imágenes, sesiones recientes y retomarlas, búsqueda de texto completo en sesiones pasadas, skills y su
recomendación. Las sesiones corren por el proveedor de IA elegido en Providers; Claude conserva el
comportamiento completo del SDK (retomar, hooks, permisos), mientras que los demás proveedores corren
turnos CLI en modo headless en la carpeta del proyecto, sin retomar ni pedidos de permiso.
- **Depende de:** shell, projects. **Vistas:** Pestañas, Skills.
- **Dueño de los slots:** `tab.views`, `tab.side`, `tab.sideReplace`, `tab.overlay`, `chat.events`,
  `composer.actions`, `tab.badges` (`web/slots.ts`); dueño de `contributeToSessions`
  (`server/contributions.ts`).
- **Aporta:** `shell.overlays` (notificaciones); hooks de proyectos (cierra las pestañas de un proyecto antes
  de borrarlo).
- **Rutas:** `GET/POST /tabs`, `PATCH/DELETE /tabs/:id`, `GET /tabs/:id/stream` (server-sent events),
  `POST /tabs/:id/send|interrupt|permission|quick|seen`, `POST /tabs/:id/tasks/:taskId/stop`,
  `GET /tabs/:id/diff`, `POST /tabs/:id/uploads`, `GET/DELETE /tabs/:id/uploads/:name`, `GET /sessions/history`,
  `POST /sessions/history/:id/resume`, `GET /sessions/search`, `GET /sessions/:id/around`, `GET /sessions/skills`,
  `PUT /sessions/skills/prefs` (en `library/profile.json`), `POST /sessions/skills/recommend`.
- **Guarda:** data `tabs.json`; state `uploads/`, `search.db`.

## providers
Detecta los CLIs de IA instalados en la máquina (Claude, OpenCode, Codex, Antigravity/Google) y deja al
usuario habilitar proveedores y elegir el predeterminado; las sesiones nuevas y las llamadas sueltas
siguen esa elección. Cada CLI conserva su propio login: la app nunca guarda claves. También responde a
los selectores de agente y modelo del composer del chat para los proveedores que los exponen (OpenCode:
agente y modelo; Codex: modelo).
- **Depende de:** projects (las opciones se ejecutan en la carpeta del proyecto). **Vista:** Providers.
- **Rutas:** `GET /providers`, `POST /providers/enabled`, `POST /providers/test`, `GET /providers/choices`.
- **Guarda:** `library/providers.json` (proveedores habilitados + predeterminado; se siembra desde el
  `tools` del entorno cuando el archivo no existe).

## home
Página de inicio: proyectos, sesiones recientes, objetivos, una bandeja de entrada y el registro del día.
- **Depende de:** shell, projects, sessions. **Vista:** Inicio. **Aporta:** una contribución a sesiones
  (registra cada turno).
- **Rutas:** `GET/PUT /home/:doc`, `POST /home/inbox`. **Guarda:** data (objetivos, bandeja, registros).

## editor
Un editor completo en cada pestaña de proyecto: árbol de archivos, Monaco con temas según la paleta,
buscar y reemplazar, un panel inferior con Problemas y Run, ajustes del editor y los equivalentes en
agent-os-nexo de las extensiones de VS Code.
- **Depende de:** themes, sessions, extensions. **Aporta:** `tab.views` (Editor).
- **Código web compartido:** `web/bus.ts` (`openInEditor`, `usePanelHeight`).
- **Rutas:** `GET/PUT /tabs/:id/file`, `GET /tabs/:id/files`, `GET /tabs/:id/image`,
  `POST /tabs/:id/fs|move|replace|open-editor`, `GET /tabs/:id/search`, `GET/PUT /tabs/:id/run`,
  `GET /tabs/:id/toolchains`, `GET /icons/manifest`, `/icons/svg/*`.
- **Submódulos** (cada uno se puede apagar; el editor funciona sin ellos):
  - **editor/terminal** — terminales reales por pestaña que viven en el servidor y se reconectan después de
    recargar; la vista Terminal. Dueño de `terminal.bar` y de los proveedores de shell (`addShellProvider`).
    Rutas `GET/POST /tabs/:id/terms`, `POST /tabs/:id/terms/:tid/input`, `DELETE /tabs/:id/terms/:tid`;
    un WebSocket por terminal.
  - **editor/lsp** — servidores de lenguaje (gopls, pyright): autocompletado, hover, ir a la definición,
    diagnósticos. `GET /lsp/:lang/status`; WebSocket `/api/tabs/:id/lsp/:lang`.
  - **editor/scm** — Git: cambios, commit, sincronizar, ramas, stash, conflictos, el grafo de commits (vista
    Git), revisión de diffs. Rutas bajo `/tabs/:id/scm/*` y `/tabs/:id/git/*`.
  - **editor/practice** — Modo práctica: el agente arma pasos con pistas y revisa el código del usuario.
    Aporta `composer.actions`. Rutas `/tabs/:id/practice*`. Guarda data (planes).
  - **editor/setup** — asistente de configuración del proyecto (plantilla, toolchains, dependencias, `.env`,
    extensiones, comandos de Run). Depende de extensions. Rutas `/tabs/:id/setup*`.

## notes
Notas libres por proyecto que un agente convierte en features; un tablero de las features leídas de
`context/features/`, y borradores para promover.
- **Depende de:** shell, projects, sessions. **Vista:** Notas.
- **Rutas:** `GET/POST /notes`, `PUT/DELETE /notes/:id`, `POST /notes/analyze|accept`,
  `GET /notes/drafts`, `DELETE /notes/drafts/:id`, `POST /notes/drafts/promote`. **Guarda:** data (notas, borradores).

## docker
Los contenedores, imágenes, logs y shells del motor; y un contenedor de desarrollo espejo por proyecto
cuyas herramientas (python, node, go…) usan primero las terminales y el agente de la pestaña.
- **Depende de:** shell, projects, sessions, editor/terminal. **Vista:** Docker.
- **Aporta:** `terminal.bar` (controles del contenedor de desarrollo), un proveedor de shell, una
  contribución a sesiones (`CLAUDE_ENV_FILE` + nota de prompt), hooks de proyectos (ofrece borrar el contenedor).
- **Rutas:** `GET /docker/info|containers|images|terms`, `POST /docker/containers/:id/:action`,
  `GET /docker/containers/:id/logs`, `DELETE /docker/images/:id`, `POST /docker/pull`,
  `POST /docker/terms`, `DELETE /docker/terms/:tid`, `GET/POST/DELETE /tabs/:id/devenv`,
  `POST /tabs/:id/devenv/install`.
- **Guarda:** state `shims/<proyecto>/` (shims, archivo de entorno, configuración del contenedor).

## ssh
Accesos SSH guardados en una bóveda cifrada, una consola SSH por pestaña de sesión, y herramientas que el
agente de la pestaña puede usar en el servidor solo mientras el usuario comparte la consola, con un plan
aprobado para cualquier cambio.
- **Depende de:** shell, projects, sessions, editor/terminal. **Vista:** SSH.
- **Aporta:** `tab.sideReplace` (la consola), `chat.events` (`ssh/plan`), `tab.badges`; una contribución a
  sesiones (herramientas MCP, guardia PreToolUse para toda sesión, limpieza al terminar turnos y al cerrar).
- **Rutas:** `GET /ssh/state`, `POST /ssh/setup|unlock|lock`, `GET/POST /ssh/hosts`,
  `PUT/DELETE /ssh/hosts/:id`, `POST /ssh/hosts/:id/open`, `GET /ssh/sessions/:tabId`,
  `POST /ssh/sessions/:tabId/connect|share`, `POST /ssh/plans/:planId`; WebSocket `/api/ssh/term/:tabId`.
  Todo salvo `/ssh/state`, `/setup` y `/unlock` necesita la cookie de la bóveda.
- **Guarda:** data `vault/vault.json` (AES-256-GCM); state `run/` (archivos de clave temporales).
  Diseño y modelo de amenazas: `modules/ssh/CONTRACT.md`, [security.md](security.md).

## architecture
La arquitectura definida del proyecto (un documento y un plan de carpetas con reglas por carpeta), el
Arquitecto flotante que aconseja contra el código real, y una nota que hace que el agente de cada pestaña la siga.
- **Depende de:** projects, sessions, editor. **Aporta:** `tab.views` (Arquitectura), `tab.overlay` (el
  Arquitecto), una contribución a sesiones (nota de prompt salvo que la pestaña la haya apagado).
- **Rutas:** `GET /architecture/:project`, `PUT /architecture/:project/doc|tree`,
  `POST /architecture/:project/import|advise|chat`,
  `DELETE /architecture/:project/chat`, `POST /tabs/:id/architecture`.
- **Guarda:** el `context/architecture/` del proyecto (`architecture.md`, `tree.json`, `advice.json`,
  `chat.json`); meta de la pestaña `archOff`.

## http
Un cliente HTTP con colecciones, entornos e importación de curl / Postman.
- **Depende de:** shell. **Vista:** Cliente HTTP.
- **Rutas:** `GET/PUT /http`, `POST /http/send`. **Guarda:** data (colecciones, entornos).

## monitor
Uso de tokens y costo estimado de cada sesión de IA, y los límites de uso del plan en el riel.
- **Depende de:** shell, sessions. **Vista:** Monitor. **Aporta:** `rail.footer`, una contribución a
  sesiones (lee los límites de uso).
- **Rutas:** `GET /limits`, `GET /usage/summary`, `GET /usage/sessions`.

## extensions
Extensiones de VS Code por proyecto (recomendadas por stack o por un agente, sincronizadas a
`.vscode/extensions.json`) y sus equivalentes en el editor de agent-os-nexo.
- **Depende de:** shell, projects, sessions. **Vista:** Extensiones.
- **Rutas:** `GET /extensions`, `PUT /extensions/general`, `POST /extensions/install`,
  `GET/PUT /projects/:id/extensions`, `POST /projects/:id/extensions/sync|recommend`.

## visual-bugs
Una galería de capturas de lo que se ve mal en agent-os-nexo, con notas, para que un agente las lea y las arregle.
- **Depende de:** shell. **Vista:** Errores visuales.
- **Rutas:** `GET/POST /visual-bugs` (el POST recibe la imagen cruda), `GET/PATCH/DELETE /visual-bugs/:name`.
  **Guarda:** data (imágenes + `index.json` con las notas).

## docs
Esta documentación dentro de la app, en el idioma de la app (en inglés cuando un documento todavía no tiene
traducción): un índice, búsqueda de texto completo y un lector donde los links entre documentos se abren ahí mismo.
- **Depende de:** shell. **Vista:** Docs.
- **Rutas:** `GET /docs?lang=`, `GET /docs/search?q=&lang=`, `GET /docs/:slug?lang=`.
- **Lee:** `docs/<lang>/*.md` del build que corre (viaja con él); `src/core/docs.ts` los interpreta, y
  `npm run docs` regenera `docs/README.md`, el índice para leer fuera de la app.
