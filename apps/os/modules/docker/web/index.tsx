// docker: the engine's containers, images, logs and shells, and the project's dev container bar in the Terminal view.
import { Container } from "lucide-react";
import { defineModule } from "@os/registry";
import type { TerminalBar } from "../../editor/submodules/terminal/web/slots";
import { DockerView } from "./DockerView";
import { DevEnvBar } from "./DevEnvBar";
import { es } from "./messages";
import "./docker.css";

export default defineModule({
  views: [{ id: "docker", label: "Docker", icon: Container, order: 55, component: DockerView }],
  slots: {
    "terminal.bar": [{ id: "devenv", component: DevEnvBar } satisfies TerminalBar],
  },
  messages: { es },
});
