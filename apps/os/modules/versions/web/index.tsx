// versions: your agent-os builds (Settings) and the "restart to load the new one" banner.
import { defineModule } from "@os/registry";
import type { BannerItem, SettingsSection } from "../../shell/web/slots";
import { NewBuildBanner } from "./NewBuildBanner";
import { Versions } from "./Versions";
import "./versions.css";

export default defineModule({
  slots: {
    "settings.sections": [{ id: "versions", label: "Versions", order: 20, component: Versions } satisfies SettingsSection],
    "shell.banners": [{ id: "new-build", component: NewBuildBanner } satisfies BannerItem],
  },
  messages: {
    es: {
      Versions: "Versiones",
      "This is the preview of os/source. Approve it to make a new build.": "Esta es la vista previa de os/source. Aprobala para generar una versión nueva.",
      "Running {v}. Changes you approve become a new build; agent-os never restarts on its own.":
        "Corriendo {v}. Los cambios que apruebes se convierten en una versión nueva; agent-os nunca se reinicia solo.",
      "No builds yet.": "Todavía no hay versiones.",
      running: "en uso",
      "loads on next start": "carga al reiniciar",
      pinned: "fijada",
      "Load this one next": "Cargar esta al reiniciar",
      "Always load the newest": "Cargar siempre la más nueva",
      "Version {v} is ready. Restart agent-os to load it.": "La versión {v} está lista. Reiniciá agent-os para cargarla.",
      Later: "Después",
    },
  },
});
