// editor: the Editor view of a tab. Its submodules (terminal, lsp, scm, practice, setup) add their parts when on.
import { PenLine } from "lucide-react";
import { defineModule } from "@os/registry";
import type { TabViewDef } from "../../sessions/web/slots";
import { EditorWorkspace } from "./EditorWorkspace";
import { es } from "./messages";
import "./editor.css";

export default defineModule({
  slots: {
    "tab.views": [{ id: "editor", label: "Editor", icon: PenLine, order: 10, component: EditorWorkspace, when: (tab) => !!tab.project } satisfies TabViewDef],
  },
  messages: { es },
});
