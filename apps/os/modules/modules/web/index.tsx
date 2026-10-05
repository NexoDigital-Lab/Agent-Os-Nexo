// modules: the module manager, shown in Settings.
import { defineModule } from "@os/registry";
import type { SettingsSection } from "../../shell/web/slots";
import { ModuleManager } from "./ModuleManager";
import "./modules.css";
import { es } from "./messages";

export default defineModule({
  slots: {
    "settings.sections": [{ id: "modules", label: "Modules", order: 30, component: ModuleManager } satisfies SettingsSection],
  },
  messages: { es },
});
