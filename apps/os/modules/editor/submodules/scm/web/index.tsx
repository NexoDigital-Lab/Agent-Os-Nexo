// editor/scm: the Git view of a tab (commit graph); the editor shows Changes and diff review when this is on.
import { GitBranch } from "lucide-react";
import { defineModule } from "@os/registry";
import type { TabViewDef } from "../../../../sessions/web/slots";
import { GitGraph } from "./GitGraph";
import { es } from "./messages";

export default defineModule({
  slots: {
    "tab.views": [{ id: "git", label: "Git", icon: GitBranch, order: 30, component: GitGraph, when: (tab) => !!tab.project } satisfies TabViewDef],
  },
  messages: { es },
});
