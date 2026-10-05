# environments — features

Oct 4, 2026

## Decidido en la charla

La carpeta se llama `blueprints/`, arranca vacía y se llena con lo que surge de trabajar.

```
blueprints/
├── index.json          qué hay y cuándo usar cada uno
└── <nombre>/
    ├── README.md       cuándo usarlo, qué resuelve, versiones probadas
    ├── steps.md        pasos que sigue el agente
    ├── files/          plantillas y configs
    └── verify.md       cómo comprobar que quedó andando
```

- Cómo nace: la IA analiza la feature terminada y, si sirve como blueprint, se lo propone al usuario como pregunta. Si no, el usuario se lo pide.
- Un comando de fábrica (un md con instrucciones, en `nexo_bases/`) explica cómo crear un blueprint o una base de código avanzada. El agente lo conoce desde la instalación.
- No vienen blueprints de fábrica: ocuparían espacio al pedo.
- No se versionan, igual que library. Lo que sí está fijo son sus convenciones de creación, para que se generen sin errores.

## Qué es

`features/` es la carpeta de `environments` para lo reutilizable entre proyectos: configs de monorepo, librerías difíciles de configurar y features completas. Está acordado que existe, que se puede subdividir y que el agente responsable puede reorganizarla. El nombre `features/` es provisorio y el detalle interno queda pendiente. Todo lo que sigue sobre estructura y uso es propuesta para charlar, no decisión.

## Qué trae del v1

El v1 no tiene un equivalente directo: lo más parecido son docs ad-hoc dentro de cada proyecto.

| Hoy en el v1 | En environments | Qué mejora |
| --- | --- | --- |
| No existe un lugar para lo reutilizable entre proyectos | `features/` lo concentra | Se configura una vez y se reusa en todos |
| Configs y setups viven como docs sueltos en `Business/<p>/` (por ejemplo `infra-deploy.md`, `feats/<x>.md`) | Piezas con estructura propia y versión probada | Menos reexplorar y menos tokens por proyecto |
| `Business/<p>/` no tiene contrato: cada proyecto tiene un árbol distinto | La anatomía de una pieza es fija | Se sabe qué esperar al abrir cualquiera |
| Las reglas de infra, como "en prod de un proyecto: solo SQL + pulls", viven en memoria | Pueden ir en la pieza que corresponda | Quedan versionadas y no dependen de la memoria |

## Cómo se trabaja (propuesta)

Cada pieza de `features/` es una carpeta autocontenida con una anatomía fija. Esto es propuesta, no decisión.

```
features/
  monorepo/
    turborepo-pnpm/          # una pieza
      PIECE.md               # cuándo usarla, pasos, versiones probadas
      templates/             # archivos para copiar
      verify.sh              # comando que comprueba que funciona
  libraries/
    capacitor-android/
      PIECE.md
      templates/
      verify.sh
  features/
    auth-jwt/
      PIECE.md
      templates/
      verify.sh
```

La anatomía de una pieza:

- **Cuándo usarla:** el caso de uso y cuándo no aplica.
- **Pasos:** el orden para aplicarla.
- **Templates o archivos:** lo que se copia o se toma de referencia.
- **Cómo verificar:** un comando o chequeo que confirma que quedó andando.
- **Versiones probadas:** con qué versiones de las librerías se probó.

La subdivisión la maneja el agente responsable. Puede partir una carpeta que crece o agrupar piezas parecidas, y deja el cambio anotado.

Hay tres formas de aplicar una pieza a un proyecto:

- **Copia:** se copian los templates al proyecto y de ahí se vuelven suyos.
- **Referencia:** el proyecto apunta a la pieza y la usa tal cual.
- **Aplicación guiada por el agente:** el agente lee la pieza, adapta los pasos al proyecto y corre la verificación.

Cuando las versiones de las librerías se mueven, la pieza puede quedar vieja. La propuesta es que el análisis periódico compare las versiones probadas con las actuales, usando comandos de `library/`. Si difieren, marca la pieza como posiblemente vencida y la vuelve a verificar antes de reusarla.

## Opciones abiertas

Hay tres decisiones por tomar, y ninguna está resuelta.

**1. Nombre de la carpeta.** `features/` choca con los `feats/` de cada proyecto.

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| `features/` | Si preferís seguir con el nombre provisorio | Se confunde con `feats/` de los proyectos |
| `recipes/` | Si pensás las piezas como pasos para cocinar un resultado | Suena a solo pasos, menos a archivos listos |
| `kits/` | Si pensás las piezas como paquetes de archivos para copiar | Poco claro para las que son solo guías |
| `blueprints/` | Si pensás en estructuras base de proyecto | Suena grande para una config chica |
| `patterns/` | Si pensás en soluciones repetidas | Se confunde con patrones de diseño de código |

**2. Forma de aplicar una pieza.**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Copia | Cuando el proyecto va a divergir de la pieza | El proyecto no recibe mejoras de la pieza |
| Referencia | Cuando querés una sola fuente de verdad | Un cambio en la pieza rompe varios proyectos |
| Aplicación guiada por el agente (recomendado) | Cuando cada proyecto necesita adaptar los pasos | Gasta más tokens y depende de la verificación |

**3. Estructura interna inicial.**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Plana, una carpeta por pieza | Mientras hay pocas piezas | Se vuelve inmanejable al crecer |
| Por categorías (monorepo, librerías, features) | Si ya sabés qué tipos vas a tener | Una categoría mal elegida obliga a mover piezas |
| Que el agente la organice solo | Si preferís no decidirlo ahora | Estructura menos predecible |

## Preguntas para charlar

Estas preguntas ayudan a cerrar el detalle que hoy está pendiente.

- [ ] ¿Qué nombre te cierra para la carpeta, dado que `features/` choca con `feats/`?
- [ ] ¿Qué tres piezas concretas querrías tener primero?
- [ ] ¿Preferís copiar, referenciar o que el agente aplique la pieza adaptada?
- [ ] ¿Qué tan estricta tiene que ser la verificación antes de dar una pieza por buena?
- [ ] ¿Cómo querés enterarte cuando una pieza puede estar vencida por cambios de versión?
