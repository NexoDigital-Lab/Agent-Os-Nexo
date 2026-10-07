---
title: Revisar un módulo
summary: Cómo revisar un módulo o un cambio contra las reglas e informar qué corregir.
order: 4
---

# Revisar un módulo

Cómo cualquiera —quien mantiene el proyecto, un colaborador o un agente al que le piden "revisá este
módulo"— chequea un módulo contra [module-rules.md](module-rules.md) e informa qué arreglar. La skill de
fábrica `nexo-module-review` sigue estos pasos.

## 1. Alcance

Nombrá qué se revisa: un módulo (`modules/<nombre>`), una rama o PR, o el `os/source` del usuario. Leé el
`module.json` del módulo, su entrada en [modules.md](modules.md) y el diff (o todos los archivos, si el
módulo es nuevo).

## 2. Primero los chequeos de la máquina

```bash
node scripts/check-modules.ts --module <id>   # en este repo (o: nexo os check --module <id>)
npm run check                                 # tipos + todos los tests
npm run coverage                              # cada archivo del servidor al 80% (ramas 70%)
```

Cada hallazgo M es **blocker**; copialos al informe tal cual salen. Tests o tipos que fallan también son blocker.

## 3. Leer buscando las reglas R

Recorré el código con esta lista; cada ítem nombra su regla.

- **R1** estructura: los archivos esperados, un comentario de cabecera en cada uno.
- **R2** nombres y rutas bajo el prefijo del propio módulo; clases CSS con prefijo.
- **R3** cada ruta valida su entrada; los errores usan `httpError` con el status correcto; rutas de archivos
  por `safePath`; procesos con lista de argumentos; nada pesado en `register`.
- **R4** datos en el lugar correcto; JSON escrito de forma atómica; ningún secreto en texto plano ni en un log.
- **R5** sin editar otros módulos para enchufarse; los puntos de extensión nuevos viven en su dueño y están
  documentados.
- **R6** componentes de submódulos solo detrás de `isActive`; el padre funciona con ellos apagados.
- **R7** se reusan clases y helpers del host; todo el ancho; estados de carga, vacío y error; accesibilidad;
  `ConfirmDelete` para acciones destructivas; polling prolijo.
- **R8** todo texto visible por `t()`, marcadores en vez de pedazos pegados.
- **R9** las herramientas de agentes se protegen solas; el texto para agentes se enmascara; sin listeners
  nuevos; los WebSockets chequean el origen.
- **R10** tests para la lógica con ramas; un test de regresión por cada bug arreglado.
- **R11** versión subida en el paso correcto; [modules.md](modules.md) y la descripción del manifiesto verdaderas.
- **R12** tipos estrictos, sin `any`/`!` sueltos, sin TypeScript no borrable.

Después buscá bugs comunes: condiciones de carrera (una respuesta lenta que pisa una más nueva), limpieza que
falta (timers, listeners, procesos), off-by-one, caminos de error que dejan el estado escrito a medias.

## 4. Verificá antes de informar

Un hallazgo dice qué pasa, no qué podría pasar: ejecutá el camino de código, escribí la entrada que falla o
señalá la línea exacta. Descartá lo que no puedas respaldar, o marcalo **sin verificar**.

## 5. Informe

Una línea por hallazgo, los más graves primero:

```
[blocker] R3 modules/foo/server/index.ts:42 — POST /api/foo/items acepta cualquier `name` (sin límite de largo):
          un nombre de 10 MB se escribe en os/data/foo/items.json. Arreglo: rechazar nombres de más de 120 caracteres con 400.
[major]   R7 modules/foo/web/List.tsx:18 — sin estado vacío: una lista vacía muestra una tarjeta en blanco.
          Arreglo: <p className="empty">{t("No items yet.")}</p>.
[minor]   R2 modules/foo/web/foo.css:3 — la clase .row no tiene prefijo del módulo. Arreglo: .foo-row.
```

Cada línea: gravedad, regla, `archivo:línea`, qué sale mal (concreto) y el arreglo. Cerrá con la cantidad por
gravedad y si se puede mergear o compilar (sin blockers); nunca "se ve bien" sin haber corrido el paso 2.
