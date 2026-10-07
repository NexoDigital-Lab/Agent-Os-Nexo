# agent-hub v2 — propuesta

Oct 4, 2026

agent-hub y agent-os-nexo pasan a ser una librería npm que instala un entorno de trabajo con agentes. Este doc junta lo acordado en la charla; todo lo demás es borrador. Solo local: sin GitHub todavía.

## Decisiones tomadas

Cuarenta y seis decisiones cerradas; la arquitectura de la raíz está terminada.

| Tema | Decisión |
| --- | --- |
| Distribución | Librería npm que instala el entorno. Lo diferencial es el entorno |
| Relación con el v1 | Repo nuevo, trayendo muchas bases del v1 |
| agent-os-nexo | Repo propio, con base y lógica propias; dentro del entorno va buildeado y versionado |
| Workspace | Carpeta local separada, sin sync por ahora |
| GitHub | Todavía no: ni repo ni remote |
| Orden de trabajo | Primero la base completa, después el detalle de cada parte |
| Nombres | Un solo idioma para nombrar cosas. El entorno se llama `environments` |
| Markdown en la raíz | Solo `AGENTS.md`, que señala dónde está el resto. `CLAUDE.md` y los md de otras tools van en una carpeta aparte: no siempre será Claude |
| Config | `environment.config.json`: suma el OS, el controlador de carpetas y las convenciones del entorno donde se trabaja |
| Análisis del OS | Claude analiza cada tanto el OS donde se trabaja, con comandos que viven en `library/` (búsqueda de versiones y más) |
| Proyectos | `projects/` (el ex `Business/`) se elimina. `code/` pasa a llamarse `projects/`: ahí se clonan los repos y cada proyecto separa un workspace (lógica de negocio, convenciones, automatizaciones futuras) del código |
| MCP | Carpeta nueva para conexiones: Drive, Notion y otros |
| Secrets | Por proyecto, no en la raíz. SSH: proyecto aparte o tal cual |
| Producto y repo | El agente se llama Nexo y va a ser open source. Repo: github.com/NexoDigital-Lab/Agent-Os-Nexo. Se trabaja ahí después de terminar de definir |
| Instalador y AGENTS.md | El instalador actualiza lo general y crea las carpetas. AGENTS.md define qué hace cada carpeta y cómo se maneja, para que el agente no rompa la arquitectura |
| skills, agents, hooks | Dentro de library/, no en la raíz |
| Memoria | library/memory/; lo de un proyecto va a su workspace |
| Tools | AGENTS.md es general; por ahora se trabaja con Claude y la config queda lista para sumar otras |
| Regla de nombres | Inglés y minúsculas. Plural para carpetas que juntan muchos ítems del mismo tipo (projects, features, skills, agents, hooks); singular para áreas y archivos (library, os, mcp, environment.config.json). La raíz queda environments/; el config describe ese environment, por eso va en singular |
| .state | En la raíz: todo lo generado (logs, índices, cache, análisis del OS, datos de uso de os). Se puede borrar y se regenera; no se edita a mano |
| Qué es environments | La copia viva de Nexo en la máquina: el repo es la plantilla, environments es donde se trabaja. Un environment por instalación; la ruta se elige al instalar (default \~/environments) y queda en environment.config.json. Si algún día hacen falta varios, se instala otro en otra ruta, cada uno con su config |
| projects por dentro | \<nombre>-ws/ cuando el proyecto tiene varias partes, con un context/ compartido; cada parte tiene code/ (repo limpio) y context/ (todo lo de la IA). Un solo repo o monorepo se saltea el -ws. La creación se automatiza y queda en las convenciones de projects |
| features → blueprints | La carpeta de piezas reutilizables se llama blueprints/ |
| context, secrets, automations | Cada parte tiene code/, context/, secrets/ y automations/ (futuro). context/ no se versiona por defecto; versionado opcional o export rápido, más adelante |
| SSH | Dentro de os, en un vault cifrado que la IA no toca por su cuenta |
| library vacía | El instalador crea library/ con index.json y carpetas, sin datos; su contenido no se versiona en el repo de Nexo |
| permissions.json | Qué puede hacer el agente solo: allow / deny / ask por acción, al estilo MCP |
| nexo\_bases/ | Vive en el repo de Nexo, dentro del paquete npm, no en environments/. Trae lo de fábrica (skills por defecto, hooks, comandos-atajo como CT y nexo-dev, permissions por defecto); npx nexo init lo coloca en library/ y nexo update lo actualiza. Política de actualización: se define con la config de npm |
| Qué se llena solo | Lo del agente (memoria, convenciones, diccionario) se llena y actualiza solo, con índice y carpetas por tema para leer solo lo necesario. Skills, hooks y comandos como nexo-dev se preguntan antes |
| Clonar proyecto | Comando o botón de fábrica: clona en projects/ con carpetas, convenciones y md del agente ya preparados |
| AGENTS.md, fuente única | Toda IA lee AGENTS.md. Codex y OpenCode lo leen solos; Claude Code con un CLAUDE.md de una línea (@AGENTS.md); Gemini configurado para usarlo. El instalador genera eso solo para las IAs habilitadas en environment.config.json. A verificar al armar los adaptadores |
| md del proyecto | AGENTS.md de cada proyecto al lado de code/, no adentro: el repo queda limpio y la IA lo encuentra igual. En un -ws, uno en el ws y uno por parte. Lo genera el comando de clonar y el agente lo completa |
| Config flaco | environment.config.json solo guarda lo que no existe en otro lado: versión y política de Nexo, raíz, tools habilitados, carpetas (para que la IA sepa dónde está todo) y un resumen del OS. Las convenciones van en library. Qué puede tocar la IA se define en permissions.json |
| Análisis del OS | Al arrancar se chequea si nunca corrió o si pasó mucho tiempo, y se recomienda al usuario correr el comando; no corre solo |
| mcp → library/connections | Las conexiones (MCP) pasan a library/connections/ y salen de la raíz. Identidad y preferencias van en library/profile.json |
| Carpetas por tool | La carpeta md por tool pasa a carpetas ocultas generadas: .claude/CLAUDE.md (@AGENTS.md), .gemini/ y las que haga falta. En la raíz y en cada proyecto. A verificar al armar los adaptadores |
| blueprints | Arranca vacío y no se versiona. La IA propone un blueprint al terminar una feature, o el usuario lo pide; un comando de fábrica (md con instrucciones) define cómo crearlo sin errores |
| connections | library/connections/ guarda definiciones y credenciales (sin carpeta secrets aparte), incluye los conectores de claude.ai con las IAs a las que están conectados. Se agrega con comando guiado, botón en os o plantilla a mano |
| os | Gestor de versiones personal (1.0.0, preview y aprobación antes de cada build, aviso de reinicio). Módulos autodetectados por manifiesto, con gestor para activarlos. La base viene del repo; un agente integra base y versión personal. La versión mayor es solo de Nexo. Detalle en el doc de os |
| permissions.json | allow / ask / deny por acción (archivos, comandos, connections, os); lo no listado cae en default. Uno global, editable desde la configuración de usuario en os, y uno por proyecto en su context/ que pisa al global. El instalador lo traduce a los permisos nativos de cada IA y un hook cubre el resto. Lo edita el usuario; el agente solo pidiendo permiso o guiando al usuario. Perfiles listos al instalar (estricto, normal, relajado) y después editables |
| Metodologías de fábrica | Comandos md en nexo\_bases/ con la misma ficha: nexo-ticket (alias CT; tickets en context/tickets/ + sync opcional a una connection), nexo-dev (fix o feature, tamaño S/M/L automático que el usuario puede cambiar, gates de plan y resultado, dial Relax/Medio/Focus/Práctica), nexo-idea (doc de opciones), nexo-research (informe con fuentes) y nexo-debug (causa raíz, fix y prueba). El cierre del día no es de fábrica: va en la library del usuario |
| Formato de skills, agents y hooks | Skill = carpeta con SKILL.md (frontmatter name, description, owner nexo/user, version; máximo 200 líneas) + references/, scripts/, evals/. Agent = md con model, tools y tope de respuesta; techo de modelo configurable en profile.json (haiku por defecto, sonnet máximo). Hook = json neutro traducido a cada IA. AGENTS.md máximo 120 líneas. Lo de fábrica se escribe en inglés, pero el agente responde en el idioma en que le habla el usuario. nexo doctor revisa el formato y avisa |
| CLI nexo | TypeScript (Node). La CLI hace lo determinístico y el agente la llama. Comandos: init, update, doctor, analyze, clone \<repo> \[--ws\], new, connect, os (versions, use) |
| Git | Default de fábrica en library/conventions/git/: commits en inglés y descriptivos, autor = identidad de profile.json sin trailer de co-autor (configurable), ramas feat/\<ticket> y fix/\<ticket>, push y PR en ask, force push a la principal en deny; nexo-dev termina en el commit local |
| Política de actualización | nexo update solo pisa lo que tiene owner: nexo. Para modificar algo de fábrica se copia como owner: user y queda del usuario |

## Estructura del entorno

> Diagrama interactivo en el doc original (estructura del entorno · 4 bases acordadas, 6 propuestas); no se exporta.

La raíz tiene un solo md (`AGENTS.md`); lo propio de cada tool, los secrets y el workspace de cada proyecto viven más abajo para no llenar la raíz.

## Raíz del entorno

La raíz quedó en ocho piezas; lo de fábrica viene en `nexo_bases/` dentro del paquete npm y `nexo init` lo coloca en `library/`.

| Elemento | Qué guarda |
| --- | --- |
| `AGENTS.md` | Reglas globales; único md visible, señala dónde está todo |
| `.claude/` `.gemini/` … | Carpeta oculta por IA, generada; solo apunta a AGENTS.md |
| `environment.config.json` | Flaco: versión y política de Nexo, raíz, tools, carpetas, resumen del OS |
| `library/` | Lo del usuario: conventions, dictionary, commands, memory, skills, agents, hooks, connections, profile.json, permissions.json. Vacía al instalar, no se versiona |
| `blueprints/` | Configs y bases de código reutilizables; arranca vacía, no se versiona |
| `os/` | source/, versions/ y data/ del agent-os-nexo personal |
| `projects/` | `<nombre>-ws/<parte>/` o `<nombre>/`, cada uno con code/, context/, secrets/ y automations/ (futuro) |
| `.state/` | Lo generado: logs, índices, cache; se regenera |

Cada pieza tiene su doc con el detalle de lo decidido.

## Preguntas abiertas de la raíz

Todas respondidas en la charla; ver Decisiones tomadas. Solo queda diferida la migración de lo que hoy hay en `.personal/` y en la memoria de Claude, que se ve al migrar.

## Agenda: cosas a normalizar

Agenda completa; solo queda diferida la migración del v1.

- [x] Raíz del entorno y distribución npm
- [x] Detalle de cada base: library, blueprints, os, projects
- [x] Metodologías de trabajo
- [x] Entorno de cada proyecto
- [x] Estructura de cada proyecto
- [x] Skills, agents y hooks: formato, tamaño, idioma
- [x] Docs y AGENTS.md
- [x] Memoria
- [x] CLI nexo y lenguaje
- [x] Nombres e idioma
- [x] Git
- [x] Permisos
- [ ] Migración del v1 (diferida)

## Metodologías de trabajo

Cinco comandos de fábrica en `nexo_bases/`, todos con la misma ficha: disparador, entrada, salida, gates, cuándo está hecho y qué no hace.

| Comando | Qué hace |
| --- | --- |
| nexo-ticket (alias CT) | Crea el ticket en context/tickets/ y lo sincroniza con una connection si existe |
| nexo-dev | Fix o feature: tamaño S/M/L propuesto y editable, gates de plan y resultado, dial Relax/Medio/Focus/Práctica |
| nexo-idea | Doc de opciones, sin decidir |
| nexo-research | Informe con fuentes |
| nexo-debug | Causa raíz, fix y prueba |

Invariantes de AGENTS.md: evidencia antes de decir listo, opciones cuando hay más de un camino, confirmar lo irreversible, respetar permissions.json, responder en el idioma del usuario.

## Diagnóstico del v1

El v1 funciona, pero creció orgánico (79 commits en unas 6 semanas); esto es lo que el v2 tiene que estandarizar.

| Problema | Evidencia |
| --- | --- |
| Sin contrato por proyecto | proyectos sin `context.md`, otros vacíos, carpetas ad-hoc |
| Reglas escritas en prosa, no en datos | `dev-budget` (210 líneas), `pipeline-cost-model.md` (241) |
| Skills gigantes y sin esqueleto común | `agent-dev` 476 líneas, `graphify` 713 |
| Dos formatos para lo mismo | 8 comandos y 15 skills |
| 15 scripts sueltos, 5 con tests | `bin/claude/` |
| Paths hardcodeados | `skills/backup`, `skills/skill-manager` |
| Personal y genérico mezclados | skills personales, reglas de clientes, identidad git en `AGENTS.md` |
| Estado en 5 lugares | memoria de Claude, `.personal/`, `.pipeline/`, `os/data/`, backlog |
| Backlog que funciona como diario | `agent-hub-backlog.md`, 265 líneas por fecha |
| `AGENTS.md` cargado | Unos 700 tokens por turno |
| Huérfanos | `Comands Mobile/`, `skills/.trash/`, `bin/opencode/` vacío |
| agent-os-nexo dentro del hub | `os/` con server, web y desktop |
| Idioma mezclado | Skills en inglés, docs en español, `propuestas/` vs `proposals/` |
| Multi-tool solo de nombre | Skills, hooks y agents cableados a Claude Code |
