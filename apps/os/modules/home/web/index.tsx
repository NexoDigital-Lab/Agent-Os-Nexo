// home: the start page.
import { House } from "lucide-react";
import { defineModule } from "@os/registry";
import { Home } from "./Home";
import { es } from "./messages";
import "./home.css";

export default defineModule({
  views: [{ id: "home", label: "Home", icon: House, order: 10, component: Home }],
  messages: { es },
});
