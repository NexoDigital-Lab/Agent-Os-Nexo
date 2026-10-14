---
title: Usar agent-os-nexo
summary: Un recorrido por la app: proyectos, pestañas de sesión, tus notas y términos, las herramientas y Ajustes.
group: start
order: 1
---

# Usar agent-os-nexo

agent-os-nexo es donde trabajás con tus agentes de IA sobre los proyectos de tu entorno Nexo. Cada proyecto
se abre en su propia pestaña con un chat, un editor y el contexto del proyecto, y todo lo que configurás
(términos, permisos, proveedores, temas) lo comparten todos tus agentes, en la app o en una terminal.

> **Tip:** esta guía es para usar la app. Para cambiar la app en sí, empezá por
> [Cómo funciona agent-os-nexo](architecture.md) y [Escribir un módulo](module-api.md).

## Abrirla

Desde una terminal, dentro de tu entorno:

```bash
nexo os start   # corre el build activo en segundo plano
nexo os open    # lo abre en el navegador, con acceso para esta ejecución
```

O abrí la app de escritorio, que arranca el mismo build sola. La app solo responde en tu propia máquina
(`127.0.0.1`) y solo al link que te da `nexo os open`: ver [Seguridad](security.md). Todo lo demás sobre
arrancar, parar y actualizar está en [Instalar, compilar, ejecutar](lifecycle.md).

## Orientarte

El **riel** de la izquierda tiene un botón por vista; el número sobre un botón cuenta lo que te espera (por
ejemplo, una pestaña que necesita una respuesta). Ajustes está abajo de todo, con tu uso del plan arriba.

| Vista | Para qué sirve |
|---|---|
| Inicio | Tus proyectos, sesiones recientes, objetivos, una bandeja para ideas rápidas y el registro del día |
| Pestañas | Las pestañas de sesión con IA: una por trabajo, cada una atada a un proyecto |
| Notas | Notas libres por proyecto; un agente las convierte en features en un tablero |
| Diccionario | Tus clientes, productos y jerga, para que ningún agente pregunte dos veces qué significa algo |
| Herramientas | Docker, SSH, el cliente HTTP, Extensiones y Monitor, cada una en su vista |

Qué vistas hay depende de los módulos que tengas prendidos: ver [Personalizarla](#personalizarla).

## Trabajar con un agente

1. Abrí un proyecto desde Inicio y empezá una **pestaña**. Una pestaña es una conversación con un agente sobre
   ese proyecto.
2. Escribí lo que querés en el compositor. El agente lee el `AGENTS.md` y el `context/` del proyecto antes de
   tocar el código, y pregunta antes de todo lo que tus permisos marcan como *preguntar*.
3. Seguí el trabajo en el chat: sus subagentes, los archivos que cambia y lo que ejecutó. Cuando termina,
   revisá sus cambios en la pestaña antes de quedártelos.
4. Cambiá la vista de la pestaña al **Editor** para leer o cambiar el código vos, a **Contexto** para los
   documentos del proyecto, o a **Arquitectura** para el plan que el agente tiene que seguir.

Las sesiones pasadas se pueden buscar y retomar. La IA detrás de cada pestaña se elige en **Proveedores**:
Claude por defecto, u otra CLI que tengas instalada y habilitada.

> **Nota:** los agentes nunca ven `secrets/` y nunca cambian lo que tus permisos niegan. Las reglas viven en
> `library/permissions.json`, y en el `context/permissions.json` de un proyecto por encima.

## Guardar lo que sabés

Los agentes trabajan mejor cuando lo que sabés está escrito una vez:

- **Notas:** volcá ideas por proyecto; pedile a un agente que convierta una nota en una feature en
  `context/features/`.
- **Diccionario:** un archivo por término en `library/dictionary/`. Todos los agentes ven la lista.
- **Contexto:** los documentos del proyecto (specs, decisiones, propuestas), editados en su pestaña.
- **Bandeja de Inicio:** una línea para después, desde cualquier lado.

## Personalizarla

Abrí **Ajustes** (abajo del riel):

- **Idioma** del texto de la app. Los agentes siempre responden en el idioma en que escribís.
- **Apariencia:** ocho paletas y las fuentes.
- **Versiones:** los builds de agent-os-nexo que tenés, y cuál se carga.
- **Permisos de los agentes:** qué pueden hacer solos los agentes, por área, global o por proyecto.
- **Documentación:** al fondo de todo, abre estas páginas.

La vista **Módulos** prende y apaga partes de la app; un cambio se aplica la próxima vez que arranca
agent-os-nexo. Cada módulo está descripto en [Módulos](modules.md).

## Cuando algo falla

- La página dice que no puede darte acceso: corré `nexo os open` de nuevo; cada ejecución tiene su link.
- Un módulo no cargó: la vista Módulos dice por qué, y el resto de la app sigue andando.
- Algo se ve mal en pantalla: guardá una captura en **Errores visuales**, así un agente lo encuentra y lo arregla.
- Cualquier otra cosa: `nexo doctor` revisa el entorno, y la sección de problemas de
  [Instalar, compilar, ejecutar](lifecycle.md) cubre los casos comunes.
