// architecture: the Architecture view of a project tab (folder plan + rules + architecture.md) and the floating
// Architect over it and the editor.
import { Blocks } from "lucide-react";
import { defineModule } from "@os/registry";
import type { TabOverlayDef, TabViewDef } from "../../sessions/web/slots";
import { ArchitectureView } from "./ArchitectureView";
import { ArchOverlay } from "./ArchOverlay";
import { es } from "./messages";
import "./architecture.css";

export default defineModule({
  slots: {
    "tab.views": [{ id: "arch", label: "Architecture", icon: Blocks, order: 40, component: ArchitectureView, when: (tab) => !!tab.project } satisfies TabViewDef],
    "tab.overlay": [{ id: "architect", component: ArchOverlay } satisfies TabOverlayDef],
  },
  messages: { es },
});
