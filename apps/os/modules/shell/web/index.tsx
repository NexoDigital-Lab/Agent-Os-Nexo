// shell: the frame every other module lives in.
import { Settings as SettingsIcon } from "lucide-react";
import { defineModule } from "@os/registry";
import "./shell.css";
import { App } from "./App";
import { Settings } from "./Settings";
import { es } from "./messages";

export default defineModule({
  root: App,
  views: [{ id: "settings", label: "Settings", icon: SettingsIcon, order: 1000, component: Settings }],
  messages: { es },
});
