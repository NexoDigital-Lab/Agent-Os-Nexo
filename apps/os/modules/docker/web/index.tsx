// docker: the engine's containers, images, logs and shells; the project's own stack as a tab view; and the project's
// dev container bar in the Terminal view.
import { Container } from "lucide-react";
import { defineModule } from "@os/registry";
import type { TerminalBar } from "../../editor/submodules/terminal/web/slots";
import type { TabViewDef } from "../../sessions/web/slots";
import { DockerView } from "./DockerView";
import { DevEnvBar } from "./DevEnvBar";
import { ProjectStack } from "./ProjectStack";
import { es } from "./messages";
import "./docker.css";

export default defineModule({
  views: [{ id: "docker", label: "Docker", icon: Container, order: 55, component: DockerView }],
  slots: {
    "terminal.bar": [{ id: "devenv", component: DevEnvBar } satisfies TerminalBar],
    "tab.views": [{ id: "docker", label: "Docker", icon: Container, order: 50, component: ProjectStack, when: (tab) => !!tab.project } satisfies TabViewDef],
  },
  messages: { es },
});
