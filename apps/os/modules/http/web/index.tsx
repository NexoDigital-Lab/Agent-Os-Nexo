// http: a Thunder Client-style HTTP client.
import { ArrowLeftRight } from "lucide-react";
import { defineModule } from "@os/registry";
import { Http } from "./Http";
import { es } from "./messages";
import "./http.css";

export default defineModule({
  views: [{ id: "http", label: "HTTP client", icon: ArrowLeftRight, order: 50, component: Http }],
  messages: { es },
});
