// "Restart now": asks once more (open sessions and terminals end), restarts agent-os-nexo on the build to load, waits
// for it to answer again (a new boot id) and reloads the page. The server keeps the access token across the restart.
import { RotateCw } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n";
import { ConfirmButton } from "./ConfirmButton";
import { hostApi } from "./http";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Restarts and resolves only when the new server answers; throws after `timeoutMs` without one. */
export async function restartOs(timeoutMs = 60_000): Promise<void> {
  const { boot } = await hostApi.restart();
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(500)) {
    const info = await hostApi.info().catch(() => null); // down while it switches over
    if (info && info.boot !== boot) return;
  }
  throw new Error(t("agent-os-nexo did not come back. Start it with `nexo os start`."));
}

export function RestartButton({ className = "btn sm primary" }: { className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  if (state === "busy") return <span className="pill accent"><span className="spin" /> {t("Restarting…")}</span>;
  return (
    <>
      <ConfirmButton
        className={className}
        title={t("Restart agent-os-nexo now")}
        confirmText={t("Restart? Open sessions and terminals end")}
        onConfirm={() => {
          setState("busy");
          restartOs().then(() => location.reload(), (e: Error) => setState(e.message));
        }}
      >
        <RotateCw size={13} /> {t("Restart now")}
      </ConfirmButton>
      {state !== "idle" && <span className="errline" role="alert">{state}</span>}
    </>
  );
}
