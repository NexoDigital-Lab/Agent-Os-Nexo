// projects: the dialogs to create, clone and delete projects (other modules open them via ./events) and the
// shared project list (./store).
import { defineModule } from "@os/registry";
import type { OverlayItem } from "../../shell/web/slots";
import { ProjectDialogs } from "./ProjectDialogs";
import "./projects.css";

export default defineModule({
  slots: {
    "shell.overlays": [{ id: "project-dialogs", component: ProjectDialogs } satisfies OverlayItem],
  },
  messages: {
    es: {
      "New project": "Nuevo proyecto",
      "<name>": "<nombre>",
      Create: "Crear",
      Clone: "Clonar",
      Close: "Cerrar",
      Cancel: "Cancelar",
      Delete: "Borrar",
      "Open and set up": "Abrir y configurar",
      "Workspace (optional)": "Workspace (opcional)",
      none: "ninguno",
      "Name (folder and repository)": "Nombre (carpeta y repo)",
      "Only lowercase letters, digits, dot, dash and underscore.": "Solo minúsculas, números, punto, guion y guion bajo.",
      Description: "Descripción",
      "What it is, in one line": "Qué es, en una línea",
      "Create the repository on GitHub and push it": "Crear el repo en GitHub y subirlo",
      Private: "Privado",
      Public: "Público",
      "Creates projects/{where} with AGENTS.md, context/ and code/ (README, .gitignore and the first commit).":
        "Crea projects/{where} con AGENTS.md, context/ y code/ (README, .gitignore y el primer commit).",
      "Also a public repository in your GitHub account.": "También un repo público en tu cuenta de GitHub.",
      "Also a private repository in your GitHub account.": "También un repo privado en tu cuenta de GitHub.",
      "Creating…": "Creando…",
      "Create project": "Crear proyecto",
      "Filter your repositories…": "Filtrar tus repos…",
      "Loading your GitHub repositories…": "Cargando tus repos de GitHub…",
      "No repository matches.": "Ningún repo coincide.",
      archived: "archivado",
      "already here": "ya está",
      "Clones into projects/{where}/code with its context ready. Then the setup assistant opens: toolchains, dependencies, .env, extensions and, optionally, nexo-onboard for the context.":
        "Clona en projects/{where}/code con su contexto listo. Después se abre el asistente: toolchains, dependencias, .env, extensiones y, si querés, nexo-onboard para el contexto.",
      "Cloning…": "Clonando…",
      "Delete {name}": "Borrar {name}",
      "Checking the project…": "Revisando el proyecto…",
      "Choose what goes. Local files go to the trash (recoverable).": "Elegí qué se borra. Lo local va a la papelera (se puede recuperar).",
      "The whole project": "Todo el proyecto",
      "code, context, secrets and AI files": "código, contexto, secrets y archivos de las IAs",
      "Only the code": "Solo el código",
      "keeps the context to clone it again later": "deja el contexto para volver a clonarlo después",
      "Nothing local": "Nada local",
      "GitHub repository": "Repo en GitHub",
      "— none": "— no tiene",
      "irreversible: issues, PRs and everything go with it": "irreversible: se borra con issues, PRs y todo",
      "Also remove its dev container": "Borrar también su contenedor de desarrollo",
      "Will be lost:": "Se pierde:",
      "{n} file(s) with uncommitted changes": "{n} archivo(s) con cambios sin commitear",
      "{n} commit(s) not pushed": "{n} commit(s) sin pushear",
      "the branch has no upstream: there may be commits that are on no remote": "la rama no tiene upstream: puede haber commits que no están en ningún remoto",
      "{n} stash(es)": "{n} stash(es)",
      "{n} file(s) of context and secrets that exist only on this machine": "{n} archivo(s) de contexto y secrets que solo existen en esta máquina",
      "{n} tab(s) of this project will close": "se cierran {n} pestaña(s) de este proyecto",
      "It has worktrees ({list}): delete them first, or they break.": "Tiene worktrees ({list}): borralos antes, si no quedan rotos.",
      "{n} tab(s) of this project are working: stop them first.": "Hay {n} pestaña(s) de este proyecto trabajando: frenalas antes.",
      "{repo} is not in your account: it can't be deleted from here.": "{repo} no es de tu cuenta: no se puede borrar desde acá.",
      "Your gh token can't delete repositories. Run this in a terminal and open this again:":
        "Tu token de gh no puede borrar repos. Corré esto en una terminal y volvé a abrir esto:",
      "Type {name} to confirm": "Escribí {name} para confirmar",
      "Deleting…": "Borrando…",
      "Type the project's exact name to confirm": "Escribí el nombre exacto del proyecto para confirmar",
      "Nothing was selected to delete": "No elegiste nada para borrar",
      "Invalid name: lowercase letters, digits, . _ - (no spaces)": "Nombre inválido: minúsculas, números, . _ - (sin espacios)",
      "The nexo CLI was not found. Install it with: npm install -g @nexodigital-lab/nexo":
        "No se encontró la CLI de nexo. Instalala con: npm install -g @nexodigital-lab/nexo",
    },
  },
});
