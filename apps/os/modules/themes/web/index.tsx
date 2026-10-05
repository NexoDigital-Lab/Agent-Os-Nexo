// themes: the palette and fonts of the whole app. Applies the saved palette at boot and adds the
// Appearance section to Settings.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/outfit/800.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./themes.css";
import { defineModule } from "@os/registry";
import type { SettingsSection } from "../../shell/web/slots";
import { ThemePicker } from "./ThemePicker";
import { initTheme } from "./theme";

export default defineModule({
  setup: initTheme,
  slots: {
    "settings.sections": [{ id: "appearance", label: "Appearance", order: 10, component: ThemePicker } satisfies SettingsSection],
  },
  messages: {
    es: {
      Appearance: "Apariencia",
      Palette: "Paleta",
      default: "por defecto",
      "lowest contrast {r}:1": "contraste mínimo {r}:1",
      Night: "Noche",
      Amber: "Ámbar",
      Ocean: "Océano",
      "Nexo Light": "Nexo Claro",
      "High contrast": "Alto contraste",
      "Nexo's identity: violet, cyan and magenta on a near-black blue ground.": "La identidad de Nexo: violeta, cyan y magenta sobre un fondo casi negro azulado.",
      "The palette of the desktop app's splash screen, based on Tokyo Night: blue and pink on a night-blue ground.":
        "La paleta de la pantalla de carga de la app de escritorio, basada en Tokyo Night: azul y rosa sobre azul noche.",
      "The warm palette of the first agent-os: warm graphite with an amber accent.": "La paleta cálida del primer agent-os: grafito tibio con acento ámbar.",
      "Teal accent with Nexo's violet as the second hue, on a very dark green ground. Calmer for long sessions.":
        "Turquesa como acento y el violeta de Nexo como secundario, sobre verde muy oscuro. Más calma para sesiones largas.",
      "Nexo's family with cyan as the accent and violet as the second hue, on navy.": "La familia de Nexo con el cyan como acento y el violeta como secundario, sobre azul marino.",
      "Nexo's magenta becomes the accent, with cyan for information. The most intense option.":
        "El magenta de Nexo pasa a ser el acento, con cyan para la información. La opción más intensa.",
      "Nexo for daylight: white grounds and a deeper violet that holds its contrast.": "Nexo para el día: fondos blancos y un violeta más profundo que mantiene el contraste.",
      "Pure black, white text and light accents. Every text pair passes AAA.": "Negro puro, texto blanco y acentos claros. Todo el texto pasa AAA.",
    },
  },
});
