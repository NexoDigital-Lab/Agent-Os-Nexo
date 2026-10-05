# environments — AGENTS.md y md por tool

Oct 4, 2026

## Decidido en la charla

AGENTS.md es la única fuente: cada IA lo lee y nadie mantiene archivos que apuntan a otros.

| Tool | Cómo llega a AGENTS.md |
| --- | --- |
| Codex, OpenCode | Lo leen solos |
| Claude Code | `CLAUDE.md` de una línea: `@AGENTS.md` |
| Gemini CLI | Configurado para usar `AGENTS.md` como archivo de contexto |

- El instalador genera esa línea o esa config solo para las IAs habilitadas en `environment.config.json`. Se verifica cada caso al armar los adaptadores.
- Vale en la raíz de environments y en cada proyecto: el `AGENTS.md` del proyecto va al lado de `code/`, nunca adentro del repo.
- La carpeta "md por tool" queda solo para lo que el instalador genera por tool.

* Cada tool tiene una carpeta oculta generada que solo apunta a AGENTS.md: `.claude/CLAUDE.md` (`@AGENTS.md`), `.gemini/` y las que haga falta. Así AGENTS.md es el único md visible, en la raíz y en cada proyecto.

## Qué es

En la raíz de `environments` hay un solo md: `AGENTS.md`. Esto está acordado: trae las reglas globales y señala dónde vive el resto. El `CLAUDE.md` y los md de otras tools (OpenCode, Codex) van en una carpeta aparte, para no llenar la raíz ni atarla a Claude. Lo que sigue (nombre de la carpeta, formato de esos archivos, presupuesto de tamaño) es propuesta, nada está decidido.

## Qué trae del v1

| Hoy en el v1 | En environments | Qué mejora |
| --- | --- | --- |
| `AGENTS.md` de \~700 tokens por turno, mezcla layout y reglas | `AGENTS.md` solo con reglas globales y mapa de punteros | Baja el costo por turno; el layout se explica en otro lado |
| `CLAUDE.md` es un symlink a `AGENTS.md` en la raíz | Los md por tool viven en una carpeta aparte | La raíz queda con un solo md |
| Reglas: opciones vía AskUserQuestion, loadout de skills, evidencia antes de "listo", commits sin co-author, techo de modelo en subagentes | Se mantienen como reglas globales | Se traen tal cual, sin reescribir |
| Pensado para Claude Code | Pensado para Claude, OpenCode, Codex y otros | No depende de una sola tool |

## Cómo se trabaja (propuesta)

La idea es que `AGENTS.md` sea corto y que cada tool tenga su archivo aparte. Todo lo de esta sección es propuesta.

```
environments/
  AGENTS.md                  # único md de la raíz
  environment.config.json
  <tools-folder>/            # nombre a definir
    claude/CLAUDE.md
    opencode/<archivo propio>
    codex/<archivo propio>
  library/  features/  os/  projects/  mcp/
  skills/  agents/  hooks/  .state/
```

**Qué lleva `AGENTS.md`.**

- Las reglas globales del v1: opciones, loadout, evidencia, commits, techo de modelo.
- Un mapa de punteros: una línea por carpeta, con a dónde ir a leer.
- Nada de explicación de layout; eso se mueve a `library/` o a docs.

**Quién escribe y quién lee.**

- Lo escribe el instalador, y la persona lo edita para sumar sus reglas.
- Lo leen todas las tools que soportan `AGENTS.md` de forma nativa.
- Las tools que no, leen su md de la carpeta aparte, que apunta a `AGENTS.md`.

**Cuándo se carga y se actualiza.**

- Se carga entero en cada turno, por eso el tamaño importa.
- Se actualiza cuando el instalador sube de versión, leyendo `environment.config.json` para no pisar lo propio.

**Reglas propuestas.**

- Los md por tool no repiten reglas: apuntan a `AGENTS.md`.
- Cada tool habilitada en `environment.config.json` tiene su md; las deshabilitadas, no.
- Presupuesto: `AGENTS.md` no pasa los \~700 tokens de hoy, idealmente menos.

## Opciones abiertas

Hay tres decisiones abiertas sobre los md por tool. Ninguna está resuelta.

**1. Nombre de la carpeta de md por tool**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| `tools/` (recomendado) | Querés un nombre corto que diga "una carpeta por tool" | Se puede confundir con herramientas o scripts |
| `adapters/` | Los md son una capa que adapta cada tool a `AGENTS.md` | Suena más técnico y menos obvio |
| `agents-md/` | Querés que el nombre diga qué contiene | Confunde con `agents/` y `AGENTS.md` |

**2. Contenido de los md por tool**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Punteros finos a `AGENTS.md` | Querés una sola fuente de verdad | Algunas tools pueden no seguir el puntero |
| Generados por el instalador | Cada tool necesita formato propio | Hay que mantener un generador por tool |
| Escritos a mano | Querés reglas distintas por tool | Se desincronizan de `AGENTS.md` |

**3. Cómo encuentra Claude Code su `CLAUDE.md`**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Symlink en la raíz y en `~/.claude/` | Linux, macOS o WSL2 con symlinks reales | No funciona en Windows nativo |
| Archivo puntero generado en esos paths | Querés evitar symlinks | Hay que regenerarlo al actualizar |
| Solo en `~/.claude/CLAUDE.md` | Nunca hay que tocar la raíz | Claude no lo ve si se abre otra carpeta como proyecto |

## Preguntas para charlar

- [ ] ¿Qué nombre te cierra para la carpeta de md por tool: `tools/`, `adapters/` u otro?
- [ ] ¿Los md por tool son punteros finos o los genera el instalador?
- [ ] ¿Te sirve un symlink para `CLAUDE.md`, o preferís un archivo generado?
- [ ] ¿Cuál es el tope de tokens para `AGENTS.md`? Hoy son \~700 por turno.
- [ ] ¿Qué tools además de Claude, OpenCode y Codex querés soportar desde el día uno?
- [ ] ¿Dónde va la explicación de layout que sale de `AGENTS.md`: `library/` o docs aparte?
