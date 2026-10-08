// context: the Context view of a project tab (AGENTS.md and context/).
import { BookOpenText } from "lucide-react";
import { defineModule } from "@os/registry";
import type { TabViewDef } from "../../sessions/web/slots";
import { ContextView } from "./ContextView";
import { es } from "./messages";
import "./context.css";

export default defineModule({
  slots: {
    "tab.views": [{ id: "context", label: "Context", icon: BookOpenText, order: 30, component: ContextView, when: (tab) => !!tab.project } satisfies TabViewDef],
  },
  messages: { es },
});
