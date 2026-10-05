# environments — environment.config.json

Oct 4, 2026

## Decidido en la charla

El config es flaco: solo guarda lo que no existe en otro lado. Esto reemplaza el ejemplo de más abajo.

```json
{
  "nexo": { "version": "0.1.0", "updatePolicy": "<se define con npm>" },
  "root": "~/environments",
  "tools": { "claude": true, "codex": false, "gemini": false, "opencode": false },
  "folders": { "library": "library", "blueprints": "blueprints", "projects": "projects", "os": "os", "state": ".state" },
  "system": { "os": "fedora 44", "shell": "bash", "lastAnalysis": "2026-10-04" }
}
```

- Las convenciones no van acá: las maneja `library/`. Identidad y preferencias van en `library/profile.json`.
- `folders` es el controlador de carpetas: la IA sabe dónde está todo. Qué puede leer, tocar o editar se define en `permissions.json`.
- `system` es solo un resumen; el detalle del análisis va en `.state/`.
- Al arrancar se chequea si el análisis nunca corrió o si pasó mucho tiempo, y se recomienda al usuario correr el comando. No corre solo.
- La mayoría de esto lo va completando el agente a medida que se trabaja.

## Qué es

`environment.config.json` es el manifiesto del entorno: un único archivo que describe quién sos, dónde trabajás y qué está habilitado. Está acordado que guarda la versión instalada, la identidad git, los tools habilitados, las preferencias, el OS, un "controlador de carpetas" y las convenciones. También está acordado que Claude analiza el OS cada tanto, usando comandos guardados en `library/`, y que el instalador lo lee para actualizar sin pisar nada. Todo lo que sigue sobre campos concretos, quién escribe qué y el formato es propuesta.

## Qué trae del v1

El manifiesto reemplaza datos que hoy están dispersos o hardcodeados.

| Hoy en el v1 | En environments | Qué mejora |
| --- | --- | --- |
| El layout vive mezclado con reglas en `AGENTS.md` (\~700 tokens/turno) | El registro de carpetas va en `environment.config.json` | `AGENTS.md` queda solo con reglas globales y apunta al resto |
| Paths hardcodeados en `skills/backup` y `skills/skill-manager` | Registro de carpetas con paths en el manifiesto | Los skills leen el path en vez de tenerlo escrito |
| Identidad git definida en reglas de commits dentro de `AGENTS.md` | Campo de identidad git en el manifiesto | Un solo lugar para el autor de los commits |
| Estado en 5 lugares (`Business/`, `.personal/`, memoria de Claude Code, etc.) | Manifiesto para configuración, `.state/` para lo generado | Se separa lo que se edita de lo que se regenera |
| No hay registro versionado de qué MCP usa cada proyecto | Tools habilitados en el manifiesto | Queda por escrito qué está activo |
| `bootstrap-machine` existe, pero sin manifiesto que lea | El instalador lee el manifiesto | Actualiza sin pisar lo que la persona configuró |

## Cómo se trabaja (propuesta)

El manifiesto separa lo que escribe la persona de lo que mide Claude, y cada parte tiene un solo dueño. Todo este ejemplo es propuesta, nada está cerrado.

```json
{
  "version": "0.1.0",
  "identity": {
    "name": "<name>",
    "email": "<git email>",
    "coAuthor": false
  },
  "os": {
    "name": "fedora",
    "version": "44",
    "arch": "x86_64",
    "shell": "bash",
    "packageManager": "dnf"
  },
  "folders": {
    "projects": "~/environments/projects",
    "library": "~/environments/library",
    "mcp": "~/environments/mcp"
  },
  "conventions": {
    "namesLanguage": "en",
    "docsLanguage": "es"
  },
  "tools": {
    "claude": true,
    "opencode": false,
    "codex": false
  },
  "preferences": {
    "subagentModelCeiling": "sonnet"
  },
  "analysis": {
    "lastRun": "2026-10-04T00:00:00Z",
    "commandsFrom": "library/commands/os"
  }
}
```

Quién escribe qué, siempre en propuesta:

- **Instalador:** `version`, el esqueleto inicial de `folders` y los defaults de `tools`. Al actualizar, solo agrega claves nuevas.
- **Analizador (Claude):** el bloque `os`. Corre los comandos de `library/` y propone los valores medidos.
- **La persona:** `identity`, `conventions`, `tools` y `preferences`. Nadie más las pisa.

Cuándo corre el análisis del OS, tres disparadores posibles: al instalar (siempre), por agenda y a pedido. El comando de cada medición (versión del OS, shell, gestor de paquetes, versiones de herramientas) vive en `library/`, así Claude no lo reinventa en cada corrida.

Reglas propuestas:

- El resultado crudo de cada corrida va a `.state/`, no al manifiesto.
- El bloque `os` del manifiesto guarda solo la última foto aceptada.
- Si la medición difiere de `os`, se reporta como drift con valor viejo y nuevo. Nada se pisa solo.
- La persona acepta o descarta el drift antes de que cambie `os`.
- El instalador nunca reescribe campos de la persona, solo agrega claves faltantes.
- JSON alcanza por ahora. Su costo es que no admite comentarios, y por eso las notas van en `library/`.

## Opciones abiertas

Hay tres decisiones sin cerrar sobre el manifiesto.

**1. Dónde viven los resultados del análisis del OS**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Foto aceptada en el manifiesto, crudo en `.state/` (recomendado) | Querés config legible y estable, con historial aparte | Dos lugares que mantener sincronizados |
| Todo dentro del manifiesto | Querés un solo archivo para mirar | El archivo cambia seguido y se ensucia el diff |
| Todo en `.state/`, manifiesto sin `os` | Querés que el manifiesto sea 100% escrito a mano | Los skills leen un archivo que no se versiona |

**2. Cuándo corre el análisis**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Solo al instalar y a pedido | Querés cero gasto de tokens en segundo plano | El dato puede quedar viejo sin que te enteres |
| Por agenda (por ejemplo semanal) | Querés detectar drift sin acordarte | Gasto periódico y hay que definir el scheduler |
| Al iniciar sesión si pasó un umbral | Querés frescura sin un proceso aparte | Puede demorar el arranque de la sesión |

**3. Formato del manifiesto**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| JSON | Ya está acordado y lo leen todas las tools | Sin comentarios |
| JSON con campo `_notes` por bloque | Querés explicar campos sin otro archivo | Ruido en el archivo |
| JSONC o YAML | Querés comentarios nativos | Se aparta del nombre `.json` acordado y suma un parser |

## Preguntas para charlar

- [ ] Cuando decís "controlador de carpetas", ¿es un registro de paths de cada carpeta, como interpretamos acá, o algo que también actúa sobre ellas?
- [ ] ¿Querés que el análisis del OS corra solo, o preferís dispararlo vos?
- [ ] Si hay drift, ¿alcanza con avisarte o querés que Claude actualice `os` con tu OK?
- [ ] ¿Qué campos de preferencias te gustaría tener desde el día uno, además del techo de modelo en subagentes?
- [ ] ¿La identidad git debe vivir en el manifiesto o seguir en la config global de git?
- [ ] ¿Te sirve JSON puro, o necesitás comentarios dentro del archivo?
