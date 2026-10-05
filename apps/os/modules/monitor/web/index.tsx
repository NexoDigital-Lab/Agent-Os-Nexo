// monitor: the Monitor view, plus the plan meter and today's cost in the rail.
import { Activity } from "lucide-react";
import { defineModule } from "@os/registry";
import type { RailItem } from "../../shell/web/slots";
import { es } from "./messages";
import { Monitor } from "./Monitor";
import { TodayCost } from "./TodayCost";
import { UsageMeter } from "./UsageMeter";
import "./monitor.css";

export default defineModule({
  views: [{ id: "monitor", label: "Monitor", icon: Activity, order: 70, component: Monitor }],
  slots: {
    "rail.footer": [
      { id: "usage", order: 10, component: UsageMeter } satisfies RailItem,
      { id: "today-cost", order: 20, component: TodayCost } satisfies RailItem,
    ],
  },
  messages: { es },
});
