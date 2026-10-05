---
title: Reglas de módulos
summary: El estándar que sigue todo módulo: reglas M que chequea la máquina y reglas R que se chequean en la revisión.
order: 3
---

# Reglas de módulos

El estándar que sigue todo módulo de agent-os: los de Nexo, los de un colaborador o los que un usuario
agrega a su copia personal. Una revisión cita estas reglas por su ID ("R4: escribe JSON sin archivo
temporal + rename") para que quien lo arregle sepa qué está mal y cómo se hace bien. Cómo hacer una
revisión: [review.md](review.md).

- Las **reglas M** son mecánicas: `node scripts/check-modules.ts` (o `nexo os check` en un entorno)
  encuentra cada incumplimiento, y `test/module-rules.test.ts` mantiene este repositorio en cero.
- Las **reglas R** requieren criterio: quien revisa las chequea leyendo el código.

Gravedad, usada en todo informe de revisión:

| Gravedad | Significa | Ejemplos |
|---|---|---|
| **blocker** | Se arregla antes de mergear o compilar | agujero de seguridad, pérdida de datos, rompe otro módulo, cualquier hallazgo M |
| **major** | Un bug o un hueco que va a doler | entrada sin validar, falta un estado de error, control inaccesible, lógica sin test |
| **minor** | Calidad | nombres, comentarios, un token que se podía reusar, redacción de docs |

### M6 — Nada de diálogos del navegador
Nada de `alert()`, `prompt()` ni `confirm()` en el código web de un módulo. Bloquean la página, no se pueden
estilizar ni traducir, y el webview de la app de escritorio puede no mostrarlos.
**Arreglo:** `askText` / `askConfirm` de `@os/lib/dialog` (devuelven una promesa), o `ConfirmButton` /
`ConfirmDelete` para una acción que necesita un segundo clic.

---

## Reglas M (las chequea la máquina)

### M1 — Manifiesto válido
`module.json` sigue `schema/module.schema.json`: `name` igual a la carpeta, `version` semver, una
`description` real, un `owner` (`nexo` o `user`), entradas que apuntan a archivos que existen. Solo los
módulos de primer nivel tienen `nav`. Un submódulo nunca lista a su padre en `dependsOn` (es implícito).
**Arreglo:** corregí el manifiesto; el mensaje del checker nombra el campo.

### M2 — Importá solo lo que declarás
Un módulo importa código solo de: sí mismo, el host (`@os/*`, `host/`), los módulos de su `dependsOn`
(y los de ellos), su padre (submódulos) y sus propios submódulos. Los imports de solo tipos también
cuentan: rompen la compilación cuando se quita ese módulo.
**Por qué:** las rutas de un módulo apagado no se montan; el código que igual llega a él falla en ejecución.
**Arreglo:** sumá el módulo a `dependsOn` si la dependencia es real; si no, mové el código compartido al
host (`host/web/src/lib/`, `host/server/`) o llegá a él por un slot / contribución (ver
[module-api.md](module-api.md)). Un padre que muestra un componente de un submódulo tiene que chequear
`isActive("<padre>/<sub>")` antes (R6).

### M3 — Los colores vienen del tema
Nada de `#hex`, `rgb()`, `rgba()`, `hsl()` en el CSS o TSX de un módulo (salvo el módulo `themes`). Usá
los tokens: `--bg`, `--bg-2`, `--panel`, `--panel-2`, `--line`, `--line-2`, `--text`, `--text-2`, `--text-3`,
`--accent`, `--accent-ink`, `--accent-text`, `--accent-dim`, `--ok(-dim)`, `--bad(-dim)`, `--info(-dim)`,
`--warn`, `--violet`, `--add`, `--del`, `--brand`, `--shadow`, `--scrim`; para matices,
`color-mix(in srgb, var(--accent) 20%, transparent)`.
**Por qué:** cada usuario elige una de ocho paletas, una de ellas clara; un color fijo queda mal en al menos una.
**Arreglo:** reemplazalo por el token que significa lo mismo; si ninguno sirve, agregá uno al módulo themes
para todas las paletas (y a `host/web/src/styles/base.css` para el primer pintado).

### M4 — Todo texto de la interfaz está traducido
Cada `t("…")` literal en el código web de un módulo tiene su español en el `web/messages.ts` del módulo o
de un módulo del que depende (o en el del host), y `web/index.tsx` lo registra con `messages: { es }`.
**Por qué:** el inglés es la clave; una entrada faltante le muestra inglés a quien usa español.
**Arreglo:** agregá la entrada al `web/messages.ts` del módulo.

### M5 — Un significado por clave
Todos los diccionarios comparten un espacio de nombres. Si dos módulos traducen la misma clave distinto,
uno de los dos se ve mal. **Arreglo:** dale un contexto al uso menos general: `t("All::containers")`
muestra "All" en inglés y busca `"All::containers"` en español. Los contextos son un `::palabra-en-minúscula`
al final.

---

## Reglas R (se chequean en la revisión)

### R1 — Estructura de un módulo
```
modules/<nombre>/
├── module.json
├── server/index.ts     export default register(ctx) — solo si hay código de servidor
├── server/*.ts         lógica, un tema por archivo
├── web/index.tsx       export default defineModule({...}) — solo si hay interfaz
├── web/api.ts          el cliente tipado: export const <nombre>Api = { … }, tipos con `import type` desde ../server
├── web/messages.ts     export const es: Record<string, string>
├── web/<nombre>.css    importado una vez, desde web/index.tsx
├── web/slots.ts        solo si el módulo es dueño de slots: las interfaces de sus ítems
├── test/*.test.ts      node:test
└── submodules/<sub>/   misma forma
```
Cada archivo empieza con un comentario que dice para qué es y lo que no sea obvio.

### R2 — Nombres y rutas
Nombres de módulo en inglés y kebab-case; archivos `camelCase.ts` para lógica y `PascalCase.tsx` para
componentes. Las rutas viven bajo el prefijo del propio módulo: `/api/<módulo>/…`, o si son de una pestaña o
un proyecto `/api/tabs/:id/<módulo>…` y `/api/projects/:id/<módulo>…`. Nunca agregues rutas bajo el prefijo
de otro módulo. Las clases CSS llevan un prefijo corto del módulo (`dk-` docker, `ssh-`, `arch-`, `vb-`)
para que los módulos nunca choquen.

### R3 — Código de servidor
- Los handlers pasan por `h()` de `host/server/http.ts`; los errores son `httpError(status, "mensaje en inglés")`
  con el status correcto (400 entrada mala, 404 desconocido, 409 conflicto, 413 demasiado grande, 5xx solo
  para fallas nuestras).
- **Validá toda entrada** en la ruta: tipo, largo, enum, rango numérico. Nunca confíes en el body, los params
  o la query, ni siquiera desde nuestra interfaz: el Bash de un agente también puede llamar a la API.
- Las rutas de archivos que vienen en un pedido pasan por `safePath(root, rel)` (`modules/projects/server/repo.ts`).
- Los procesos se lanzan con `execFile`/`spawn` y una lista de argumentos, nunca con un string de shell armado
  con la entrada.
- El trabajo largo se transmite o informa progreso; nada bloquea el event loop con entradas grandes.
- `register` es rápido: sin llamadas de red ni escaneos pesados al arrancar.

### R4 — Dónde viven los datos
| Dato | Lugar |
|---|---|
| Los datos del usuario para este módulo | `ctx.dataDir` (`os/data/<id>`) — los builds nunca lo tocan |
| Datos regenerables (cachés, índices, logs, shims) | `ctx.stateDir` (`.state/os/<id>`) |
| Conocimiento sobre un proyecto (features, arquitectura) | el `context/` del proyecto |
| El código del proyecto | `code/` — solo cuando cambiar el código es la funcionalidad misma, y la interfaz lo dice |

Los JSON se escriben de forma atómica (archivo temporal y después `rename`). Los secretos nunca van en
texto plano a `os/data` (ver la bóveda de ssh) ni a los logs.

### R5 — Extendé, no edites
Un módulo nunca cambia archivos de otro para enchufarse. Usa los puntos de extensión: slots (web),
`contributeToSessions` (sesiones de IA), `addProjectHooks` (borrado de proyectos), `addShellProvider`
(terminales), `meta` de la pestaña (`setTabMeta`). Cuando hace falta un punto de extensión nuevo, se agrega
en el módulo **dueño**, tipado en su `slots.ts` / interfaz de contribución, y documentado en
[module-api.md](module-api.md) en el mismo cambio.

### R6 — Submódulos
Un submódulo pertenece a su padre (depende de él implícitamente y se apaga con él). Un padre puede mostrar
componentes de un submódulo, pero solo detrás de `isActive("<padre>/<sub>")`, y tiene que funcionar con
todos los submódulos apagados. Preferí un slot del padre cuando el submódulo solo agrega algo.

### R7 — Interfaz
- Reusá las piezas del host antes de inventar: `.page`, `.card`, `.btn` (`primary`, `ghost`, `danger`,
  `sm`), `.field`, `.pill` (`ok`, `bad`, `info`, `accent`), `.seg`, `.modal`, `.errline`, `.faint`,
  `.empty`, `.spin`; `ConfirmDelete`, `ConfirmButton`, `askText`/`askConfirm`, `renderMarkdown`,
  `readLS`/`writeLS` de `@os/lib`.
- Las vistas usan todo el ancho: nada de `max-width` en `.page`, tarjetas o texto; solo los controles de
  formulario conservan un ancho.
- Tipografías con `var(--sans)`, `var(--display)`, `var(--mono)`.
- Toda vista tiene sus estados de carga, vacío y error.
- Accesibilidad: los botones con solo ícono tienen `aria-label` (y `title`); los diálogos tienen
  `role="dialog"`, `aria-modal`, una etiqueta, foco atrapado y Escape; los errores usan `role="alert"`; los
  interruptores usan `aria-pressed` o `role="switch"`.
- Las acciones destructivas o irreversibles preguntan dos veces con `ConfirmDelete` / `ConfirmButton`; una
  pregunta o un nombre salen de `askConfirm` / `askText` (`@os/lib/dialog`): nunca los diálogos del navegador (M6).
- Polling: cada 3 s o más, se detiene al desmontar, y una respuesta lenta de un ítem anterior nunca pisa
  al actual.

### R8 — Texto
- Inglés en código, comentarios y claves; el idioma del usuario sale de `messages.ts`.
- Todo texto visible pasa por `t()`, incluidos `title`, `aria-label` y `placeholder`.
- Las variables van en marcadores (`t("Delete {name}?", { name })`), nunca pegando pedazos traducidos; el
  orden de las palabras cambia entre idiomas.
- Los mensajes de error del servidor están en inglés; la interfaz los pasa por `t()` al mostrarlos.

### R9 — Agentes y seguridad
- Las herramientas que un módulo le da a los agentes (servidores MCP en `contributeToSessions`) se protegen
  solas: chequean el permiso del usuario para esa pestaña y rechazan con claridad; `autoAllow` solo para
  herramientas que se protegen solas.
- Las notas de prompt son cortas y solo para las pestañas donde aplican.
- Nada que un agente pueda llamar llega a credenciales; el texto que le llega a un agente desde un servidor o
  una consola pasa por `redact` (`host/server/redact.ts`).
- Un servidor, un puerto: nada de listeners nuevos. Los upgrades de WebSocket chequean `sameOrigin` antes que
  nada.
- Ver [security.md](security.md).

### R10 — Tests
La lógica de servidor con ramas (validación, parseo, políticas, máquinas de estado) tiene tests de
`node:test` en `test/`. Cada bug arreglado suma un test de regresión. `npm run check` pasa antes de cada commit.

### R11 — Versiones y documentación
Desde la primera versión publicada del módulo, subí su `version` con cada cambio (hasta entonces queda en
`1.0.0`): patch para un arreglo, minor para una funcionalidad, major
cuando cambiás un slot o contrato que usan otros módulos. Mantené verdadera la entrada del módulo en
[modules.md](modules.md) (propósito, rutas, slots, datos) y la `description` de su manifiesto, en los dos
idiomas.

### R12 — TypeScript
`strict`, nada de `any` salvo en un borde validado, nada de `!` donde un chequeo es barato. Node ejecuta el
TypeScript del servidor directamente (type stripping), así que nada de `enum`, `namespace` ni propiedades
de parámetro en constructores (`erasableSyntaxOnly`). Los tipos del servidor se importan en el código web
con `import type`.
