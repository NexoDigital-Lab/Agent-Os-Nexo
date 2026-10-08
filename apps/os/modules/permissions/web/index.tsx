// permissions: what agents may do alone, in Settings.
import { defineModule } from "@os/registry";
import type { SettingsSection } from "../../shell/web/slots";
import { es } from "./messages";
import { PermissionsSettings } from "./PermissionsSettings";
import "./permissions.css";

export default defineModule({
  slots: {
    "settings.sections": [{ id: "permissions", label: "Agent permissions", order: 25, component: PermissionsSettings } satisfies SettingsSection],
  },
  messages: { es },
});
