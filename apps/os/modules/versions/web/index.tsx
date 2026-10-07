// versions: your agent-os-nexo builds (Settings) and the "restart to load the new one" banner.
import { defineModule } from "@os/registry";
import type { BannerItem, SettingsSection } from "../../shell/web/slots";
import { NewBuildBanner } from "./NewBuildBanner";
import { Versions } from "./Versions";
import "./versions.css";
import { es } from "./messages";

export default defineModule({
  slots: {
    "settings.sections": [{ id: "versions", label: "Versions", order: 20, component: Versions } satisfies SettingsSection],
    "shell.banners": [{ id: "new-build", component: NewBuildBanner } satisfies BannerItem],
  },
  messages: { es },
});
