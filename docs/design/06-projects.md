# environments — projects

Oct 4, 2026

## Decidido en la charla

Cada proyecto junta su código y su parte de IA en una sola carpeta; no hay un business general aparte. Esto reemplaza al layout de las opciones de abajo.

```
projects/
├── <nombre>-ws/          workspace: un proyecto con varias partes (varios repos)
│   ├── context/          lo compartido por todas las partes (specs transversales, negocio general)
│   ├── <parte>/          nombre del repo o de la parte del proyecto
│   │   ├── code/         repo clonado, sin convenciones de trabajo
│   │   ├── context/      todo lo de la IA para esta parte
│   │   ├── secrets/      credenciales de esta parte, nunca versionadas
│   │   └── automations/  (futuro) automatizaciones de esta parte
│   └── <otra-parte>/
└── <nombre>/             un solo repo o monorepo: se saltea el -ws
    ├── code/
    ├── context/
    ├── secrets/
    └── automations/      (futuro)
```

- context/ guarda lógica de negocio, specs de features, otras specs, el grafo de documentación y todo lo que use el agente.
- La creación de todo esto se automatiza y queda escrita en las convenciones de projects.
- Un monorepo cuenta como proyecto individual: sus apps viven dentro de `code/`.

* context/ no se versiona por defecto. Quien quiera puede versionarlo por su cuenta; más adelante se suma versionado opcional o una exportación rápida.
* SSH no es un proyecto: vive en os, en el vault cifrado, y la IA no lo usa por su cuenta.
* Con esto projects queda cerrado; las opciones de abajo quedan como referencia.

## Qué es

`environments` es el entorno que instala la librería npm del v1 renovado, y `projects/` es la carpeta donde viven los proyectos. Está acordado que `projects/` reemplaza al viejo `Business/<p>/` y que cada proyecto separa un workspace del código. También está acordado que los secrets van por proyecto y no en la raíz. Todo lo demás de este doc (layout exacto, migración, lugar de SSH) es propuesta y queda abierto. Las automatizaciones y más detalle vienen después.

## Qué trae del v1

Del v1 se hereda la idea de separar código de contexto, pero se le agrega un contrato. Hoy cada proyecto tiene un árbol distinto.

| Hoy en el v1 | En environments | Qué mejora |
| --- | --- | --- |
| Repos clonados en `GitHub/` | Repos dentro de `projects/<name>/` | Todo lo de un proyecto queda en un solo lugar |
| Contexto en `Business/<p>/` (context.md, feats/, propuestas/, plans/, .pipeline/) | Workspace de cada proyecto, junto al repo | Reemplaza `Business/<p>/` y deja de ser un árbol distinto por proyecto |
| Sin contrato: proyectos sin context.md, otros vacíos | Estructura de workspace común a todos los proyectos | El agente sabe siempre qué archivos esperar |
| `secrets/` en la raíz | Secrets por proyecto | Cada proyecto lleva sus propias credenciales |
| Estado repartido en 5 lugares (`Business/`, `.personal/`, memoria de Claude Code, etc.) | Memoria y estado del proyecto en su workspace | Menos lugares donde buscar |
| `infra-deploy.md` libre y reglas de prod que viven en memoria (ej. "en prod: solo SQL + pulls") | Cómo correr y validar, dentro del workspace | Las reglas de un proyecto quedan escritas con el proyecto |

## Cómo se trabaja (propuesta)

La propuesta es que cada proyecto tenga dos mitades: el repo limpio y un workspace con todo lo que no va a git. Todo lo que sigue es propuesta, nada está decidido.

```
projects/<name>/
  repo/                 # git clone, solo código; sin convenciones de trabajo nuestras
  workspace/            # nunca se pushea
    context.md          # lógica de negocio y stack
    run.md              # cómo correr en local y validar un build de prod
    feats/              # un archivo por feature: estado, decisiones, archivos tocados
    plans/
    proposals/
    memory/             # lo que el agente aprende de este proyecto
    secrets/            # credenciales solo de este proyecto
    .state/             # run-log, hot-paths, índices (no se toca a mano)
    automations/        # a futuro
```

El agente encuentra el workspace desde adentro del repo por el registro de paths en `environment.config.json`. Si no lo encuentra, sube hasta `projects/<name>/` y lo busca ahí. Así el repo no necesita ningún archivo nuestro.

SSH puede ser su propio proyecto (`projects/ssh/`) o quedar como hoy, con el vault cifrado de agent-os-nexo. Falta decidirlo.

Migración desde `Business/<p>/`: se mueve cada archivo a su lugar en el workspace y se rellena lo que falte según la estructura común. `secrets/` de la raíz se reparte por proyecto. La memoria de Claude Code de cada proyecto pasa a `workspace/memory/`.

## Opciones abiertas

Hay tres decisiones que cambian la forma de `projects/`. Ninguna está tomada.

**1. Layout de cada proyecto**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| `projects/<name>/repo` + `projects/<name>/workspace` (recomendado) | Querés repo y workspace como hermanos claros, sin tocar el repo | Un nivel más de carpeta en cada ruta |
| Repo en `projects/<name>` con carpeta workspace dentro, ignorada por git | Querés rutas cortas y todo a mano | Un error en el ignore filtra el workspace al repo |
| Workspace al lado del repo (`projects/<name>` y `projects/<name>-workspace`) | Querés repos en la raíz de `projects/` | Dos carpetas por proyecto que hay que mantener emparejadas |

**2. Dónde va SSH**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Proyecto aparte | Querés que SSH tenga su propio workspace y contexto | Un proyecto sin repo de código propio |
| Queda tal cual | No querés tocar lo que ya funciona | Queda un caso especial fuera de `projects/` |

**3. Migración desde `Business/<p>/`**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Mover todo de una vez con un script | Querés cerrar el cambio rápido | Un error toca todos los proyectos a la vez |
| Proyecto por proyecto, al volver a trabajarlo | Querés migrar sin apuro | Conviven dos formatos un tiempo |

## Preguntas para charlar

Estas preguntas cierran lo que falta para pasar de propuesta a decisión.

- [ ] ¿Qué layout de proyecto te cierra más: `repo` + `workspace` como hermanos, workspace ignorado dentro del repo, o workspace al lado?
- [ ] ¿SSH es un proyecto aparte o queda como está hoy?
- [ ] ¿Migrás `Business/<p>/` de una vez o proyecto por proyecto?
- [ ] ¿Qué tiene que traer el workspace sí o sí en todos los proyectos, y qué es opcional?
- [ ] ¿La memoria del proyecto vive en `workspace/memory/` o queda en la memoria de Claude Code?
- [ ] ¿El registro de paths vive en `environment.config.json` o en otro archivo?
