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
import { es } from "./messages";

export default defineModule({
  setup: initTheme,
  slots: {
    "settings.sections": [{ id: "appearance", label: "Appearance", order: 10, component: ThemePicker } satisfies SettingsSection],
  },
  messages: { es },
});
