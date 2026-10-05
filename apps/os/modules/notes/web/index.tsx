// notes: the notepad, AI-proposed features and the features board.
import { FileText } from "lucide-react";
import { defineModule } from "@os/registry";
import { es } from "./messages";
import { Notes } from "./Notes";
import "./notes.css";

export default defineModule({
  views: [{ id: "notes", label: "Notes", icon: FileText, order: 30, component: Notes }],
  messages: { es },
});
