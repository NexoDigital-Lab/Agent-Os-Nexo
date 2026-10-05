# environments — library

Oct 4, 2026

## Decidido en la charla

library es lo del usuario: el instalador la crea vacía y lo que se guarda adentro no se versiona en el repo de Nexo.

- El instalador crea `library/` con su `index.json` y las carpetas, sin datos: no a todos les sirve lo mismo.
- `skills/`, `agents/`, `hooks/` y `memory/` van dentro de library.
- Suma `permissions.json`: qué puede hacer el agente solo, con tres valores por acción (`allow`, `deny`, `ask`), al estilo de los permisos de MCP.
- Lo de fábrica viene en el paquete npm de Nexo, en `nexo_bases/`; npx nexo init lo coloca en library/ y nexo update lo actualiza (la política de actualización se define con la config de npm). Trae las skills por defecto, hooks y comandos-atajo para el agente, por ejemplo `CT` (crear un ticket de cierta forma) y `nexo-dev` (método de trabajo para un ticket: fix o feature).

* La política de actualización de lo de fábrica se maneja en el install y queda guardada.
* Lo que es para el agente se llena y actualiza solo: memoria, convenciones, diccionario. Lo que se pregunta antes: skills, hooks y comandos como `nexo-dev`.
* Cada área tiene su índice y varias carpetas por tema, para no gastar contexto: si el agente va a hacer un commit, lee solo las convenciones de commits.
* Comando de fábrica principal: clonar un proyecto (botón en os o comando). Lo clona en `projects/` con todo preparado: carpetas, convenciones y el md del agente.
* La migración de `.personal/` y la memoria actual se ve cuando migremos.

## Qué es

`library/` es la carpeta del entorno donde vive lo reutilizable que es tuyo: convenciones, diccionario y comandos. Está acordado que existe y que guarda convenciones personales, diccionario, comandos reutilizables (para que Claude gaste menos tokens) y comandos que configura la persona. También está acordado que `environment.config.json` usa esos comandos para analizar el OS. Lo que sigue (subcarpetas exactas, manifiesto, reglas de memoria) es propuesta, no decisión.

## Qué trae del v1

La library ordena cosas que hoy en el v1 están repartidas en varios lugares.

| Hoy en el v1 | En environments | Qué mejora |
| --- | --- | --- |
| `bin/claude/` con 15 scripts, solo 5 con tests | `library/commands/` | Scripts con salida conocida, descriptos en un índice |
| Paths hardcodeados en skills/backup y skills/skill-manager | Comandos que leen `environment.config.json` | Un solo registro de paths y OS |
| `.personal/` y \~30 entradas de memoria en `~/.claude/projects/...`, estado en 5 lugares | `library/memory/` | Un solo lugar para lo que el agente aprende |
| Reglas sueltas en `AGENTS.md` (\~700 tokens por turno) | `library/conventions/` | Convenciones fuera de la raíz, cargadas a demanda |
| `commands/` con 8 comandos (quick, inves, teach, learn...) | `library/user-commands/` | Separa los comandos tuyos de los de fábrica |

## Cómo se trabaja (propuesta)

Cada subcarpeta tiene un dueño que escribe y un modo de carga: un índice chico siempre, el detalle a demanda.

```
library/
  index.json          # índice chico: lo único que se carga siempre
  conventions/        # escribe: vos (y el agente, al promover desde memory/)
                      # lee: el agente, a demanda
  dictionary/         # escribe: vos; lee: el agente cuando aparece un término
  commands/           # scripts de fábrica con salida conocida
    index.json        # manifiesto: un registro por comando
    os-info.*         # ej: análisis del OS para environment.config.json
    version-lookup.*  # ej: búsqueda de versiones
  user-commands/      # comandos que configurás vos; mismo formato de índice
  memory/             # escribe: el agente solo; lee: el agente
```

**Carga.** El agente lee `library/index.json` al arrancar. Abre una convención, un término o un comando solo cuando la tarea lo pide.

**Comandos.** Un comando es un script que el agente corre en vez de explorar, así gasta menos tokens. Cada entrada del manifiesto describe cuándo usarlo:

- `name`: nombre en inglés.
- `when`: una frase con el caso de uso.
- `output`: forma de la salida (campos, formato).
- `args`: argumentos que acepta.
- `source`: `factory` o `user`.

El agente lee solo `name` y `when` del índice. La salida completa se conoce de antemano, por eso no explora.

**Memoria (`library/memory/`).** Guarda lo que el agente aprende solo: correcciones y preferencias.

- Promoción: si algo se confirma varias veces, pasa a `conventions/`. Cuántas veces es una pregunta abierta.
- Lo específico de un proyecto no entra acá: va al workspace de ese proyecto.
- Idea a evaluar, tomada de Hermes: que promover requiera tu aprobación.

**Lo que el instalador nunca toca:**

- Todo el contenido de `library/conventions/`, `dictionary/`, `user-commands/` y `memory/`.
- Las preferencias, la identidad git y los tools de `environment.config.json`.
- Los `projects/` y sus secrets.

El instalador solo actualiza lo de fábrica, como `library/commands/`. Lee `environment.config.json` para saber qué versión hay instalada.

## Opciones abiertas

Hay tres decisiones que conviene cerrar antes de escribir código.

**1. Dónde vive la memoria**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| `library/memory/` (recomendado) | Querés un solo lugar versionable y portable entre máquinas | Hay que migrar las \~30 entradas actuales |
| Carpeta propia `memory/` en la raíz del entorno | Querés separar lo que aprende el agente de lo que escribís vos | Una carpeta más en la raíz |
| Seguir con la memoria de Claude Code | No querés tocar lo que ya funciona | Queda atada a una tool y fuera del entorno |

**2. Cómo se describen los comandos**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| `index.json` único en `commands/` | Pocos comandos y querés leerlo de una | Crece con la cantidad de comandos |
| Un `.md` o `.json` por comando, más índice generado | Muchos comandos, con detalle por cada uno | Hay que mantener el generador |
| Cabecera dentro de cada script | Querés que el script y su descripción no se separen | El agente tiene que abrir cada script para leerla |

**3. Cuándo se promueve memoria a convención**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Automática tras N confirmaciones | Querés cero fricción | Puede cristalizar una preferencia mal entendida |
| El agente propone, vos aprobás | Querés control, como en Hermes | Más interrupciones |
| Solo manual | Querés que las convenciones sean 100% tuyas | La memoria se acumula sin salida |

## Preguntas para charlar

Estas preguntas definen lo que falta de la library.

- [ ] ¿Te cierra `library/memory/`, o preferís otra ubicación para la memoria?
- [ ] ¿Cuántas confirmaciones hacen falta para promover una memoria a convención, y la aprobás vos?
- [ ] ¿Qué comandos de fábrica querés primero además del análisis del OS y la búsqueda de versiones?
- [ ] ¿Un índice único de comandos o uno por comando?
- [ ] ¿`user-commands/` va separado de `commands/`, o es un solo lugar con un campo `source`?
- [ ] ¿Qué del `Business/` y `.personal/` actuales querés migrar a `conventions/` y `dictionary/`?
