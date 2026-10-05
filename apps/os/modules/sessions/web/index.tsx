// sessions: the Tabs view (AI sessions per project), the Skills view and the notifications watcher.
// Other modules extend a tab through the slots in ./slots.ts and open tabs through ./tabs/store.ts.
import { SquareTerminal, Star } from "lucide-react";
import { defineModule } from "@os/registry";
import type { OverlayItem } from "../../shell/web/slots";
import { es } from "./messages";
import { TabWatcher } from "./notify";
import { Skills } from "./Skills";
import { attention, useTabs, WORK_VIEW } from "./tabs/store";
import { Workspace } from "./Workspace";
import "./sessions.css";

function useAttention(): number {
  return attention(useTabs().tabs);
}

export default defineModule({
  views: [
    { id: WORK_VIEW, label: "Tabs", icon: SquareTerminal, order: 20, component: Workspace, useBadge: useAttention },
    { id: "skills", label: "Skills", icon: Star, order: 80, component: Skills },
  ],
  slots: {
    "shell.overlays": [{ id: "tab-watcher", component: TabWatcher } satisfies OverlayItem],
  },
  messages: { es },
});
