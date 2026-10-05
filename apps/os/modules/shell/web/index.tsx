// shell: the frame every other module lives in.
import { Settings as SettingsIcon } from "lucide-react";
import { defineModule } from "@os/registry";
import "./shell.css";
import { App } from "./App";
import { Settings } from "./Settings";

export default defineModule({
  root: App,
  views: [{ id: "settings", label: "Settings", icon: SettingsIcon, order: 1000, component: Settings }],
  messages: {
    es: {
      Settings: "Ajustes",
      Views: "Vistas",
      Language: "Idioma",
      "Interface language": "Idioma de la interfaz",
      "Agents answer in the language you write in; this only changes the app's text.":
        "Los agentes responden en el idioma en que les escribas; esto solo cambia los textos de la app.",
      "Saved in this environment (os/data), so every build of agent-os keeps them.":
        "Se guarda en este entorno (os/data), así todas las versiones de agent-os lo conservan.",
      "No views are active. Turn modules on in Settings.": "No hay vistas activas. Activá módulos en Ajustes.",
      "{n} waiting for you": "{n} esperan por vos",
      "Zoom: Ctrl + / Ctrl − / Ctrl 0": "Zoom: Ctrl + / Ctrl − / Ctrl 0",
      "Zoom in": "Acercar",
      "Zoom out": "Alejar",
      "Reset zoom ({pct}%)": "Restablecer zoom ({pct}%)",
    },
  },
});
