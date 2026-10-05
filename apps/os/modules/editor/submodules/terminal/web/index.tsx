// editor/terminal: the Terminal view of a tab (the editor's panel uses the same terminals).
import { SquareTerminal } from "lucide-react";
import { defineModule } from "@os/registry";
import type { TabViewDef } from "../../../../sessions/web/slots";
import { TabTerminal } from "./TabTerminal";

export default defineModule({
  slots: {
    "tab.views": [{ id: "terminal", label: "Terminal", icon: SquareTerminal, order: 20, component: TabTerminal, when: (tab) => !!tab.project } satisfies TabViewDef],
  },
});
