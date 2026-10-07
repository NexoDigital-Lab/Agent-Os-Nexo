// extensions: which VS Code extensions (and agent-os-nexo editor plugins) each project uses.
import { Puzzle } from "lucide-react";
import { defineModule } from "@os/registry";
import { Extensions } from "./Extensions";
import { es } from "./messages";
import "./extensions.css";

export default defineModule({
  views: [{ id: "ext", label: "Extensions", icon: Puzzle, order: 60, component: Extensions }],
  messages: { es },
});
