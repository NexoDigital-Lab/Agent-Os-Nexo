// dictionary: your concepts, so no agent asks twice what a word means.
import { BookA } from "lucide-react";
import { defineModule } from "@os/registry";
import { Dictionary } from "./Dictionary";
import { es } from "./messages";
import "./dictionary.css";

export default defineModule({
  views: [{ id: "dictionary", label: "Dictionary", icon: BookA, order: 32, component: Dictionary }],
  messages: { es },
});
