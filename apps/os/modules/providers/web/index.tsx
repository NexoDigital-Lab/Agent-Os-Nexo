// providers: which AI provider CLIs are installed and which ones agent-os-nexo uses.
import { Bot } from "lucide-react";
import { defineModule } from "@os/registry";
import { ProvidersView } from "./ProvidersView";
import { es } from "./messages";

export default defineModule({
  views: [{ id: "providers", label: "Providers", icon: Bot, order: 60, component: ProvidersView }],
  messages: { es },
});
