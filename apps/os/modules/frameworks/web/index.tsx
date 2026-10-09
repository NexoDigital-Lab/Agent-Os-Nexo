// frameworks: third-party agent frameworks, set up once and chosen per chat tab.
import { Layers } from "lucide-react";
import { defineModule } from "@os/registry";
import { FrameworksView } from "./FrameworksView";
import { es } from "./messages";

export default defineModule({
  views: [{ id: "frameworks", label: "Frameworks", icon: Layers, order: 63, component: FrameworksView }],
  messages: { es },
});
