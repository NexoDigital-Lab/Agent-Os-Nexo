---
title: Seguridad
summary: El modelo de confianza: servidor local, chequeos de origen, los límites de los agentes, la bóveda y la consola SSH.
order: 7
---

# Seguridad

agent-os corre agentes de IA con los permisos del propio usuario, en su máquina. El diseño deja afuera
tres cosas: otros sitios web (no pueden manejar la API local), otros programas de la máquina (no se pueden
confundir con agent-os) y los propios agentes (no pueden llegar a credenciales ni actuar sobre servidores
sin la aprobación del usuario).

## El servidor

- **Solo local.** Escucha en `127.0.0.1`, un puerto (4780 la app, 4781 la vista previa, 47470 la ventana de escritorio).
- **Chequeos de host y origen** (`guardRequest`, `host/server/http.ts`), en cada pedido:
  - el header `Host` tiene que ser este servidor (frena el DNS rebinding: `evil.com` resolviendo a
    127.0.0.1 conserva su propio Host);
  - todo lo que cambia estado tiene que venir de la propia página de agent-os o de un cliente sin `Origin`
    (curl, el CLI): un sitio que el usuario visita no puede hacer POST a la API.
- **Los WebSockets** (terminales, servidores de lenguaje, la consola SSH) chequean `sameOrigin` antes del upgrade.
- Cada respuesta lleva `X-Content-Type-Options: nosniff` (los archivos del usuario nunca se interpretan como
  HTML) y `X-Agent-OS: 1`, que el CLI y la app de escritorio chequean antes de confiar en un puerto.
- **Un módulo roto nunca detiene a los demás** (`host/server/mount.ts`).

Reglas para módulos: R3 (validar toda entrada, `safePath` para rutas, lista de argumentos para procesos) y
R9 en [module-rules.md](module-rules.md).

## Agentes

- **Las lecturas se quedan en el proyecto.** Un hook PreToolUse (`confineHook`,
  `modules/sessions/server/claude.ts`) deja que el agente de una sesión lea solo dentro de sus carpetas de
  trabajo, no `~/.ssh`, secretos ni otros proyectos.
- **Los permisos** salen del entorno (`library/permissions.json`, que cada proyecto puede sobrescribir); las
  herramientas que se protegen solas (ssh) son las únicas permitidas automáticamente.
- **El texto que recibe un agente** desde una consola o el índice de sesiones pasa por `redact`
  (`host/server/redact.ts`): se enmascaran claves privadas, tokens, contraseñas y credenciales en URLs.

## SSH: la bóveda y la consola

El contrato completo está en `modules/ssh/CONTRACT.md`. En resumen:

- **Bóveda:** `os/data/ssh/vault/vault.json`, AES-256-GCM con una clave derivada por scrypt de una
  contraseña maestra que el usuario escribe después de cada arranque; carpeta 0700, archivo 0600; sin
  recuperación, por diseño. Cinco contraseñas incorrectas seguidas bloquean el desbloqueo por 30 segundos.
- **API:** todo salvo leer el estado, configurar y desbloquear necesita una cookie HttpOnly y SameSite=Strict
  que solo entregan los formularios de contraseña: el Bash de un agente puede llamar a la API pero nunca
  obtiene la cookie.
- **Consola:** la sesión SSH corre en un pty del servidor; las contraseñas guardadas y las frases de clave
  las escribe el servidor en los prompts, así que ni el navegador ni el agente las ven nunca. Los archivos de
  clave temporales viven en `.state/os/ssh/run/` por segundos.
- **El agente y la consola:** solo mientras el usuario prende "El agente ve la consola", y solo la salida
  producida desde ese momento. Los comandos de solo lectura (una lista permitida estricta, `server/policy.ts`)
  corren libres; todo lo demás necesita un plan que el usuario aprueba, válido para ese turno, y cada paso
  corre una vez.
- **La guardia** (PreToolUse, toda sesión, cualquier modo de permisos): nada de `ssh`/`scp`/`sftp` directos,
  de claves privadas, de memoria o entorno de otros procesos, de depuradores, ni de acceso a las carpetas del
  módulo ssh (`os/data/ssh`, `.state/os/ssh`, por nombre o ruta absoluta) o a su API.

## El CLI y la app de escritorio

- `nexo os start|preview` confía en un archivo pid solo si ese proceso es un servidor de agent-os (por su
  línea de comando), y solo informa "arrancó" cuando el servidor responde como agent-os.
- `nexo os stop` detiene solo la app; la vista previa necesita `--preview`: un agente que limpia su vista
  previa no puede tumbar el agent-os en el que corre.
- La app de escritorio solo carga su puerto si `/api/os/info` responde con `X-Agent-OS: 1`, y sus permisos
  nativos (notificaciones, zoom) están limitados a `http://127.0.0.1:47470`.

## Reportar un problema

Reportá los problemas de seguridad en privado por *Security → Report a vulnerability* del repositorio en
GitHub (reporte privado de vulnerabilidades), nunca en un issue público.
