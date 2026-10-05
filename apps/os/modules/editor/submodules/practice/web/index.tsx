// editor/practice: "Practice this" in the chat composer (Practice mode) hands the task to the editor, which
// shows the plan, the hints and the check (CoachPanel) when this submodule is on.
import { Target } from "lucide-react";
import { defineModule } from "@os/registry";
import type { ComposerAction } from "../../../../sessions/web/slots";
import { es } from "./messages";

export default defineModule({
  slots: {
    "composer.actions": [
      {
        id: "practice",
        label: "Practice this",
        icon: Target,
        workMode: "practice",
        primary: true,
        run: (view, prompt) => {
          view.handoff.give("practice-task", prompt);
          view.go("editor");
        },
      } satisfies ComposerAction,
    ],
  },
  messages: { es },
});
