// "tab.badges": a key on SSH tabs, plus "the agent sees" while the console is shared.
import { Eye, KeyRound } from "lucide-react";
import { t } from "@os/i18n";
import type { Tab } from "../../sessions/web/api";
import { sshOf } from "./api";
import { useSshShared, useSshSharedPoll } from "./sharedStore";

export function SshTabBadge({ tab }: { tab: Tab }) {
  const ssh = sshOf(tab);
  useSshSharedPoll(ssh ? tab.id : null);
  const shared = useSshShared().has(tab.id);
  if (!ssh) return null;
  return (
    <>
      <KeyRound size={12} aria-label={t("SSH session")} />
      {shared && <span className="tab-claude" title={t("The agent sees the console")}><Eye size={11} aria-hidden="true" /> {t("agent sees")}</span>}
    </>
  );
}
