// visual-bugs: screenshots of what looks wrong, for an agent to fix.
import { Bug } from "lucide-react";
import { defineModule } from "@os/registry";
import { es } from "./messages";
import { VisualBugs } from "./VisualBugs";
import "./visual-bugs.css";

export default defineModule({
  views: [{ id: "bugs", label: "Visual bugs", icon: Bug, order: 90, component: VisualBugs }],
  messages: { es },
});
