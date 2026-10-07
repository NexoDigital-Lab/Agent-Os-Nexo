// "New version detected — restart agent-os-nexo to load it." Checked every minute; agent-os-nexo never restarts itself:
// the user does, with the button.
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { hostApi } from "@os/lib/http";
import { RestartButton } from "@os/lib/RestartButton";

export function NewBuildBanner() {
  const [newer, setNewer] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const check = () => hostApi.info().then((i) => setNewer(i.newer), () => {});
    void check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  if (!newer || newer === dismissed) return null;
  return (
    <div className="banner" role="status">
      <span>{t("Version {v} is ready. Restart agent-os-nexo to load it.", { v: newer })}</span>
      <RestartButton />
      <button className="btn sm ghost" onClick={() => setDismissed(newer)}>{t("Later")}</button>
    </div>
  );
}
