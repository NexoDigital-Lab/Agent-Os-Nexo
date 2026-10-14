// docs: the agent-os-nexo documentation inside the app, in the app's language. No rail button: it opens from the
// last block of Settings, so it does not take a place among the views used every day.
import { BookOpen } from "lucide-react";
import { defineModule } from "@os/registry";
import type { SettingsSection } from "../../shell/web/slots";
import { Docs, DocsSettings } from "./Docs";
import { es } from "./messages";
import "./docs.css";

export default defineModule({
  views: [{ id: "docs", label: "Docs", icon: BookOpen, order: 92, component: Docs, hidden: true }],
  slots: { "settings.sections": [{ id: "docs", label: "Documentation", order: 1000, component: DocsSettings } satisfies SettingsSection] },
  messages: { es },
});
