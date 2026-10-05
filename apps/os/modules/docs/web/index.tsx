// docs: the agent-os documentation inside the app, in the app's language.
import { BookOpen } from "lucide-react";
import { defineModule } from "@os/registry";
import { Docs } from "./Docs";
import { es } from "./messages";
import "./docs.css";

export default defineModule({
  views: [{ id: "docs", label: "Docs", icon: BookOpen, order: 92, component: Docs }],
  messages: { es },
});
