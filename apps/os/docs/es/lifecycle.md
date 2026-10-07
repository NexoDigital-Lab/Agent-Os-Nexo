---
title: Instalar, compilar, ejecutar
summary: Los comandos nexo os: instalar, vista previa, chequear, compilar, arrancar, detener, versiones y solución de problemas.
order: 6
---

# Instalar, compilar, ejecutar

agent-os-nexo es opcional en un entorno Nexo. Todo lo de acá es un comando `nexo os`
(`packages/cli/src/commands/os.ts`); la estructura del entorno está en [architecture.md](architecture.md).

## Instalar

```bash
nexo init --os yes                              # al crear el entorno, o después:
nexo os install                                 # desde npm (@nexodigital-lab/agent-os-nexo)
nexo os install --from <Agent-Os-Nexo>/apps/os  # desde un checkout (hasta que el paquete se publique)
```

1. El paquete se copia en `os/source/` (sin `node_modules`, `dist`, `.git`). Desde ahí es la copia propia
   del usuario; install se niega a pisarla.
2. Sus dependencias se instalan una sola vez en `os/runtime/<hash>/`, donde el hash nombra el conjunto de
   dependencias (`dependencies` + `devDependencies`). El runtime cuenta como listo solo cuando npm termina
   (`.ready`), así que una instalación interrumpida se rehace, nunca se reusa.
3. `os/source/node_modules` apunta a ese runtime, y el primer build pasa a ser `1.0.0`.

Si un paso falla, volvé a correr `nexo os install`: retoma con el source ya copiado.

## Cambiar, probar, compilar

```bash
nexo os preview            # os/source con recarga en caliente en http://localhost:4781
nexo os stop --preview     # detener solo la vista previa
nexo os check              # las reglas de módulos (module-rules.md) — no tiene que informar nada
nexo os build --notes "qué cambió"
```

`build` corre `os/source/scripts/build.ts` en `os/versions/<siguiente>.building/`: Vite compila `dist/web`,
se copia el código de servidor (sin fuentes web ni tests), `build.json` registra versión, fecha, notas y
runtime, y `node_modules` apunta al runtime. Solo un build completo se renombra a `os/versions/<siguiente>`;
uno que falla no deja nada. Las versiones suben el patch de a uno, `x.y.9` → `x.(y+1).0`; el major queda
reservado para las versiones de Nexo. Un source cuyas dependencias cambiaron obtiene un runtime nuevo; los
builds anteriores conservan el suyo.

## Ejecutar

```bash
nexo os start [--port 4780]   # el build activo, en segundo plano; vuelve cuando responde
nexo os status                # builds instalados, el activo, qué está corriendo y su log
nexo os open [--preview]      # abrirla en el navegador con el link de acceso de esta ejecución
nexo os stop                  # la app (sumá --all para detener también la vista previa)
nexo os use 1.0.3             # fijar un build; `nexo os use latest` vuelve al más nuevo
```

Cada ejecución tiene su propio link de acceso (security.md): `start` lo muestra y `open` lo abre, así que después
de un reinicio el navegador necesita `nexo os open` de nuevo. El build activo es el que está fijado en
`os/current`, o el más nuevo. La app que está corriendo busca un
build más nuevo y muestra "Nueva versión detectada: reiniciá para cargarla"; nunca se reinicia sola, y los
agentes nunca la reinician. Logs y archivos pid: `.state/os/app.log`, `.state/os/preview.log`, `*.pid`.

## Actualizar a una nueva versión de Nexo

`os/source` es un repositorio git: la rama `base` tiene las versiones de Nexo tal como salen, `main` tiene tu
versión (cada build es un commit con el tag `v<x.y.z>`).

```bash
nexo os update [--from <checkout>/apps/os]   # la versión nueva va a base y se mergea en main
nexo os update --continue                    # después de resolver los conflictos (sin marcas)
nexo os update --abort                       # abandonar: tu versión queda como estaba
```

Tus cambios pendientes se commitean antes, así que no se pierde nada. Donde vos y Nexo cambiaron las mismas
líneas, el merge se frena y lista los archivos; resolvelos a mano o pedíselo a un agente (conserva tu cambio y
toma el de Nexo donde no chocan), y después `--continue`, `nexo os check`, `nexo os preview` y `nexo os build`.
Un source instalado antes de que existieran las actualizaciones no tiene historial: instalalo de nuevo para empezarlo.

## Ventana de escritorio

`apps/desktop` en el repositorio compila una app Tauri que corre el mismo build activo en su propia ventana
(puerto 47470) y lo detiene al cerrarla. Ver su README.

## Solución de problemas

| Síntoma | Causa y arreglo |
|---|---|
| `start` dice que terminó, con un pedazo del log | Leé el extracto: un puerto en uso (`--port`), un módulo que falló al compilar, un runtime que falta (`nexo os build`). |
| `start` dice que otro agent-os-nexo responde en el puerto | Ya hay uno corriendo ahí (quizás de la app de escritorio o una vista previa): usalo, o `--port`. |
| Falta un módulo en la app | Ajustes → Módulos muestra si está apagado, esperando un reinicio, o si no cargó (con el error). |
| La vista previa muestra tipografías de reemplazo | Un source viejo sin el runtime en la lista permitida de Vite: actualizá `vite.config.ts` desde una versión más nueva. |
| `install` no puede descargar el paquete | Todavía no está publicado: `nexo os install --from <checkout>/apps/os`. |
| Se acumulan builds | Cada uno pesa unos 20 MB (el bundle web; las dependencias viven en el runtime compartido). Los viejos se pueden borrar a mano, salvo el activo. |
