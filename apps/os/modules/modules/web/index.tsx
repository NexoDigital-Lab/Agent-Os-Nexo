// modules: the module manager, shown in Settings.
import { defineModule } from "@os/registry";
import type { SettingsSection } from "../../shell/web/slots";
import { ModuleManager } from "./ModuleManager";
import "./modules.css";

export default defineModule({
  slots: {
    "settings.sections": [{ id: "modules", label: "Modules", order: 30, component: ModuleManager } satisfies SettingsSection],
  },
  messages: {
    es: {
      Modules: "Módulos",
      Module: "Módulo",
      Version: "Versión",
      "Depends on": "Depende de",
      State: "Estado",
      core: "núcleo",
      on: "activo",
      off: "apagado",
      "on after restart": "activo al reiniciar",
      "off after restart": "apagado al reiniciar",
      "Enable {name}": "Activar {name}",
      "Loading…": "Cargando…",
      "Restart agent-os to apply the changes.": "Reiniciá agent-os para aplicar los cambios.",
    },
  },
});
