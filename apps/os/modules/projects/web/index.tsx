// projects: the dialogs to create, clone and delete projects (other modules open them via ./events) and the
// shared project list (./store).
import { defineModule } from "@os/registry";
import type { OverlayItem } from "../../shell/web/slots";
import { ProjectDialogs } from "./ProjectDialogs";
import "./projects.css";
import { es } from "./messages";

export default defineModule({
  slots: {
    "shell.overlays": [{ id: "project-dialogs", component: ProjectDialogs } satisfies OverlayItem],
  },
  messages: { es },
});
