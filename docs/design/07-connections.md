# environments — mcp

Oct 4, 2026

## Decidido en la charla

La carpeta se llama `connections/` y vive dentro de `library/`; ahí está todo lo de cada conexión, credenciales incluidas.

```
library/connections/
├── index.json          qué conexiones hay, para qué sirve cada una y con qué IAs está conectada
├── notion.json         definición: tipo (MCP), cómo se conecta, para qué usarla
└── …
```

- Tokens, MCPs y credenciales viven en connections, sin carpeta secrets aparte. Como library no se versiona, no salen de la máquina.
- Los conectores de claude.ai (Notion, Drive, Claude Docs y otros) también se registran, con las IAs a las que están conectados.
- Cada proyecto lista qué conexiones usa y el agente carga solo esas.
- El instalador genera la config MCP de cada IA habilitada a partir de estas definiciones.
- Qué puede hacer el agente con cada conexión se define en `permissions.json`.

* Una conexión nueva se agrega de tres formas: con un comando guiado ("conectá Slack": el agente arma la definición, pide el token, genera la config de cada IA y prueba la conexión), con un botón en os, o a mano con una plantilla.

## Qué es

`mcp/` es la carpeta de `environments` donde viven las conexiones a servicios como Drive y Notion. Está acordado que existe y que guarda esas conexiones. Todo lo demás de este doc es propuesta para charlar: no hay código, repo ni GitHub todavía. La idea es que las conexiones queden versionadas dentro del entorno y no sueltas en la configuración de cada tool.

## Qué trae del v1

Hoy las conexiones MCP existen pero no están registradas en ningún lado del repo.

| Hoy en el v1 | En environments | Qué mejora |
| --- | --- | --- |
| Conectores de claude.ai (Notion, Google Drive, Claude Docs y otros) | Una definición por conexión dentro de `mcp/` | Queda versionado qué conexiones existen |
| Configurados fuera del repo | Viven dentro del entorno | Se reconstruye en otra máquina sin rehacerlos a mano |
| Sin registro versionado de qué MCP usa cada proyecto | El workspace de cada proyecto declara sus conexiones | Se sabe qué usa cada proyecto |
| Secrets en `secrets/` de la raíz | Secrets por proyecto, referenciados desde `mcp/` | Las credenciales no se mezclan con las definiciones |

## Cómo se trabaja (propuesta)

La propuesta es un archivo de definición por conexión, y cada tool genera su config a partir de ahí.

```
mcp/
  notion.json        # una definición por conexión
  google-drive.json
  analytics.json
  claude-docs.json
```

- **Global vs por proyecto (propuesta):** una conexión puede quedar habilitada globalmente. El workspace de un proyecto lista cuáles usa.
- **Credenciales (propuesta):** nunca van dentro de los archivos de `mcp/`. Cada definición referencia un secret del proyecto o uno global.
- **Una fuente, varias tools (propuesta):** se escribe la conexión una vez. El instalador genera la config MCP propia de cada tool: Claude Code, OpenCode y Codex.
- **Para qué sirve cada una (propuesta):** cada definición lleva una descripción corta de su propósito. Así el agente sabe cuándo usarla, sin que `AGENTS.md` cargue esa explicación en cada turno.

## Opciones abiertas

Quedan tres decisiones por tomar antes de armar `mcp/`.

**1. Dónde se declara qué conexiones usa un proyecto**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Lista en el workspace del proyecto (recomendado) | Querés que cada proyecto sea autocontenido | Hay que mantener una lista por proyecto |
| Lista central en `environment.config.json` | Querés ver todo en un solo lugar | El manifiesto crece y mezcla proyectos |

**2. Formato de las definiciones**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| JSON | Querés que los tools lo lean casi tal cual | Sin comentarios |
| Markdown con frontmatter | Querés sumar la descripción de uso junto a la config | Hay que parsearlo para generar las configs |

**3. Cuándo se generan las configs de cada tool**

| Opción | Cuándo elegirla | Costo o riesgo |
| --- | --- | --- |
| Al instalar o actualizar el entorno | Querés un paso único y predecible | Un cambio manual en `mcp/` no se refleja hasta volver a correr |
| Al abrir cada proyecto | Querés que siempre esté al día | Corre en cada arranque |

## Preguntas para charlar

Estas preguntas ayudan a cerrar el diseño de `mcp/`.

- [ ] ¿Qué conexiones actuales querés llevar al v2: las cuatro o solo algunas?
- [ ] ¿Hay conexiones que sean siempre globales y otras que solo tengan sentido en un proyecto?
- [ ] ¿Querés que las credenciales de conexiones globales vivan fuera de cualquier proyecto?
- [ ] ¿Cuántos tools vas a usar de verdad: Claude Code, OpenCode, Codex u otros?
- [ ] ¿Preferís que el agente describa para qué sirve cada conexión, o escribirlo vos?
