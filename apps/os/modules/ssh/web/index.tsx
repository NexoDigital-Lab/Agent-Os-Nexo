// ssh: saved SSH accesses (rail view) and SSH session tabs: the console replaces the chat's side column, plans
// show in the chat, and the tab bar marks SSH tabs (and whether the agent sees the console).
import { KeyRound } from "lucide-react";
import { defineModule } from "@os/registry";
import type { ChatEventRenderer, TabBadge, TabSideReplacement } from "../../sessions/web/slots";
import { sshOf } from "./api";
import { SshPlanCard } from "./SshPlanCard";
import { SshSide } from "./SshSide";
import { SshTabBadge } from "./TabBadge";
import { SshView } from "./SshView";
import { es } from "./messages";
import "./ssh.css";

export default defineModule({
  views: [{ id: "ssh", label: "SSH", icon: KeyRound, order: 58, component: SshView }],
  slots: {
    "tab.sideReplace": [{ id: "ssh", when: (tab) => !!sshOf(tab), component: SshSide, chatOnly: true, label: (tab) => `ssh · ${sshOf(tab)?.hostName ?? ""}` } satisfies TabSideReplacement],
    "chat.events": [{ module: "ssh", type: "plan", component: SshPlanCard } satisfies ChatEventRenderer],
    "tab.badges": [{ id: "ssh", component: SshTabBadge } satisfies TabBadge],
  },
  messages: { es },
});
