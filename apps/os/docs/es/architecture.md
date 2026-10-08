---
title: Cómo funciona agent-os-nexo
summary: El servidor, la app web, dónde vive cada cosa en un entorno y cómo cooperan los módulos.
order: 1
---

# Cómo funciona agent-os-nexo

agent-os-nexo es un único proceso de Node.js que sirve una API HTTP y una app React en `127.0.0.1`. Todo lo
que hace —proyectos, pestañas de sesiones de IA, el editor, Docker, SSH…— sale de **módulos**; el host
solo los descubre, los monta y les da algunos servicios compartidos.

```
navegador / ventana de escritorio ──HTTP + WebSocket──▶ host/server/main.ts (127.0.0.1:4780)
                                                          ├── guardRequest          mismo origen + header X-Agent-OS-Nexo
                                                          ├── /api/os/*             rutas del host (info, módulos, preferencias)
                                                          ├── /api/…                register(ctx) de cada módulo activo
                                                          ├── upgrades WebSocket    terminales, LSP, consola SSH
                                                          └── dist/web (un build) o middleware de Vite (--dev, la vista previa)
```

## Dónde corre

agent-os-nexo siempre corre dentro de un **entorno Nexo** (la carpeta que crea `nexo init`):

| Ruta | Qué guarda agent-os-nexo ahí |
|---|---|
| `os/source/` | La copia editable del usuario (este paquete) |
| `os/versions/<x.y.z>/` | Builds: `dist/web` + el código de servidor + `build.json` |
| `os/runtime/<hash>/` | Dependencias, compartidas por todo build con el mismo conjunto (el `node_modules` de un build apunta acá) |
| `os/data/` | Persistente: `prefs.json`, `modules.json` y `os/data/<módulo>/` por módulo |
| `.state/os/` | Regenerable: cachés `<módulo>/`, logs, archivos pid de `nexo os` |
| `projects/<id>/` | Los proyectos: `code/`, `context/`, `worktrees/`, `AGENTS.md` |
| `library/` | Skills, agentes, hooks, perfil (`profile.json`) que usan las sesiones de IA |

El servidor encuentra el entorno por `NEXO_ROOT`, o subiendo desde su propia carpeta hasta encontrar
`environment.config.json` (`host/server/env.ts`).

## Arranque, lado servidor (`host/server/main.ts`)

1. Lee el entorno y la versión (`build.json`, o `"source"` con `--dev`).
2. Descubre los módulos: cada `modules/<nombre>/module.json` y `modules/<nombre>/submodules/<sub>/module.json`
   (`src/core/modules.ts`). Los manifiestos inválidos, las dependencias desconocidas y los ciclos se
   informan y se saltean.
3. Decide cuáles están activos: los core siempre; el resto salvo que estén apagados en `os/data/modules.json`;
   un módulo cuya dependencia está apagada también queda apagado.
4. En orden de dependencias, importa el `entry.server` de cada módulo activo y llama a `register(ctx)`. Un
   módulo que falla al cargar se saltea junto con los que dependen de él (`host/server/mount.ts`); el
   resto arranca igual, y la vista Módulos muestra el error.
5. Sirve la app web: Vite en modo middleware con HMR en el mismo puerto (`--dev`), o `dist/web`.

Rutas del host: `GET /api/os/info` (versión, build más nuevo, entorno, idioma), `GET/PUT /api/os/modules`
(listar, prender/apagar con chequeo de dependencias), `GET/PUT /api/os/prefs` (tema, idioma).

## Arranque, lado web (`host/web/src/main.tsx`)

1. Le pregunta al servidor qué módulos están activos y las preferencias del usuario. Sin la cookie de acceso
   de esta ejecución (`host/server/access.ts`) la API responde 401 y la página explica cómo entrar (`nexo os open`).
2. Importa el `web/index.tsx` de cada módulo activo (`import.meta.glob` los deja todos disponibles en el
   bundle; solo se cargan los activos), registra sus traducciones y corre su `setup()`.
3. Renderiza el `root` que provee el módulo shell. El shell arma el riel con las `views` de cada módulo, y
   cada slot con los ítems que aportan los módulos activos.

Un módulo apagado no tiene ni rutas ni interfaz. El código que dependa de él tiene que declararlo (M2) o
chequear `isActive` (R6).

## Cómo cooperan los módulos

Los módulos nunca se meten en las entrañas de otros; usan los puntos de extensión que declara el dueño
([module-api.md](module-api.md)):

- **Slots** (web): el dueño renderiza `slot<T>("nombre")`, los demás aportan ítems.
- **Contribuciones a sesiones** (servidor): notas de prompt, entorno, herramientas MCP, hooks, observadores de turnos.
- **Hooks de proyectos** (servidor): datos y pasos cuando se borra un proyecto.
- **Proveedores de shell** (servidor): qué shell corre en la terminal de un proyecto (el contenedor de desarrollo de docker).
- **Eventos de módulo**: `{ kind: "module", module, type, id, waiting?, data }` en el stream de una pestaña.
- **Meta de la pestaña**: datos por módulo en una pestaña que sobreviven a los reinicios.

## Idioma y aspecto

El inglés es la clave de cada texto de la interfaz; el `web/messages.ts` de cada módulo agrega el español
(`host/web/src/i18n.ts`). El módulo themes aplica una de ocho paletas como propiedades CSS en `:root`, y de
ahí deriva los temas de Monaco, xterm y el grafo de git; los módulos solo usan los tokens.

## Versiones

Un historial personal por usuario: probás un cambio (`nexo os preview`), lo compilás al aprobarlo
(`nexo os build`) y la app que está corriendo muestra "Nueva versión detectada: reiniciá para cargarla".
Detalles en [lifecycle.md](lifecycle.md).

## Seguridad

Solo local, un puerto, chequeo de mismo origen, una bóveda para las credenciales SSH y una guardia que
mantiene a los agentes lejos de ellas. Detalles en [security.md](security.md).
