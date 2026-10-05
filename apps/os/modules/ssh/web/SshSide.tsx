// "tab.sideReplace" for SSH tabs: host + connection state, the "The agent sees the console" switch and the live
// console (xterm over /api/ssh/term/:tabId). A second side tab keeps the Agents panel reachable.
import { Lock, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@os/i18n";
import { isLocked } from "@os/lib/http";
import { Agents } from "../../sessions/web/Agents";
import type { SidePanelProps } from "../../sessions/web/slots";
import { Terminal } from "../../editor/submodules/terminal/web/Terminal";
import { sshApi, sshOf, type SshConnState, type SshSessionInfo } from "./api";
import { UnlockForm } from "./UnlockForm";
import { setSshShared } from "./sharedStore";

const STATE: Record<SshConnState, { label: string; cls: string }> = {
  connecting: { label: "connecting", cls: "info" },
  connected: { label: "connected", cls: "ok" },
  closed: { label: "closed", cls: "bad" },
};
const UNKNOWN_STATE = { label: "no connection", cls: "bad" };

export function SshSide({ tab, stream }: SidePanelProps) {
  const { running, runningTasks, tasks, activity, liveModel, pendingPerms } = stream;
  const [side, setSide] = useState<"ssh" | "agents">("ssh");
  const [info, setInfo] = useState<SshSessionInfo | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0); // bump to remount the console (reconnect / after unlock)
  const [busy, setBusy] = useState(false);

  const epoch = useRef(0); // bumped by every share/connect action: poll responses that started earlier are stale
  const termBox = useRef<HTMLDivElement>(null);

  const fail = useCallback((e: unknown) => (isLocked(e) ? setLocked(true) : setError((e as Error).message)), []);

  const apply = useCallback((i: SshSessionInfo) => (setInfo(i), setSshShared(tab.id, !!i.shared)), [tab.id]);

  const refresh = useCallback(() => {
    const e = epoch.current;
    return sshApi
      .session(tab.id)
      .then((i) => {
        if (e !== epoch.current) return; // an action ran meanwhile: this answer is older than its result
        apply(i);
        setLocked(false);
        setError("");
      })
      .catch((err) => e === epoch.current && fail(err));
  }, [tab.id, fail, apply]);

  // Poll while mounted (state / busy change on the server without any event reaching the UI).
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function toggleShare() {
    if (!info || busy) return;
    setBusy(true);
    epoch.current++;
    try {
      apply(await sshApi.share(tab.id, !info.shared));
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      epoch.current++;
      setBusy(false);
    }
  }

  async function reconnect() {
    if (busy) return;
    setBusy(true);
    epoch.current++;
    try {
      apply(await sshApi.connect(tab.id));
      setError("");
      setGen((g) => g + 1);
    } catch (e) {
      fail(e);
    } finally {
      epoch.current++;
      setBusy(false);
    }
  }

  // Focus the console (xterm's hidden textarea) on mount, after Reconnect / unlock, and when coming back to this panel.
  useEffect(() => {
    if (side !== "ssh" || locked) return;
    const timer = setTimeout(() => termBox.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")?.focus(), 80);
    return () => clearTimeout(timer);
  }, [gen, side, locked]);

  const st = info ? (STATE[info.state] ?? UNKNOWN_STATE) : null;
  const shared = !!info?.shared;
  const host = sshOf(tab);

  return (
    <section className="side">
      <div className="side-tabs">
        <button className={side === "ssh" ? "on" : ""} aria-pressed={side === "ssh"} onClick={() => setSide("ssh")}>SSH</button>
        <button className={side === "agents" ? "on" : ""} aria-pressed={side === "agents"} onClick={() => setSide("agents")}>
          {t("Agents")} {running && <span className="dot live" style={{ marginLeft: 4 }} />}
          {runningTasks > 0 && <span className="pill ok">{runningTasks}</span>}
        </button>
      </div>
      {side === "agents" ? (
        <div className="side-body">
          <Agents tabId={tab.id} tasks={tasks} running={running} activity={activity} model={liveModel} waitingPerm={pendingPerms > 0} />
        </div>
      ) : (
        <div className="ssh-side">
          <div className="ssh-side-head">
            <span className="ssh-side-name" title={info?.hostName ?? host?.hostName}>{info?.hostName ?? host?.hostName ?? "SSH"}</span>
            {st && <span className={`pill ${st.cls}`} role="status">{t(st.label)}{info?.busy ? ` · ${t("running")}` : ""}</span>}
            <span style={{ flex: 1 }} />
            <button className="btn sm" onClick={reconnect} disabled={busy || locked}><RefreshCw size={14} /> {t("Reconnect")}</button>
          </div>
          {locked ? (
            <div className="ssh-locked-note"><Lock size={14} aria-hidden="true" /> {t("Vault locked")}</div>
          ) : (
            <>
              <div className={`ssh-share ${shared ? "on" : ""}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={shared}
                  aria-labelledby={`ssh-share-label-${tab.id}`}
                  className="ssh-switch"
                  disabled={!info || busy}
                  onClick={toggleShare}
                >
                  <span className="ssh-track" aria-hidden="true"><span className="ssh-knob" /></span>
                  <span id={`ssh-share-label-${tab.id}`} className="ssh-share-label">{t("The agent sees the console")}</span>
                  <span className="ssh-share-state">{shared ? t("On") : t("Off")}</span>
                </button>
              </div>
              {shared && <p className="ssh-share-note">{t("The agent only reads what happens from now on; for changes it asks you for a plan.")}</p>}
            </>
          )}
          {info?.state === "connecting" && <p className="ssh-hint" role="status">{t("If the console asks something (yes/no for the host, a password), answer there.")}</p>}
          {error && <div className="errline" role="alert">{error}</div>}
          {locked ? (
            <UnlockForm compact onUnlocked={() => (setLocked(false), setGen((g) => g + 1), refresh())} />
          ) : (
            <div className="ssh-term" ref={termBox}>
              <Terminal key={gen} tabId={tab.id} url={`/api/ssh/term/${tab.id}`} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
