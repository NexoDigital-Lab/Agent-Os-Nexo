// modules: the module manager, a view of its own in the rail.
import { Blocks } from "lucide-react";
import { defineModule } from "@os/registry";
import { ModuleManager } from "./ModuleManager";
import "./modules.css";
import { es } from "./messages";

export default defineModule({
  views: [{ id: "modules", label: "Modules", icon: Blocks, order: 95, component: ModuleManager }],
  messages: { es },
});
