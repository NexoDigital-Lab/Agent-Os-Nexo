// "terminal.bar" slot: a slim strip above the tab's terminals with the project's dev container
// (create / reinstall deps / recreate / remove). It loads its own status and opens the wizard.
import { useCallback, useEffect, useRef, useState } from "react";
import { Container, PackageCheck, RefreshCw, Trash2 } from "lucide-react";
import { t } from "@os/i18n";
import type { Tab } from "../../sessions/web/api";
import { dockerApi as api, type DevEnvStatus, type Lang } from "./api";
import { DevEnvWizard } from "./DevEnvWizard";

const SHIMS: Record<Lang, string> = { python: "python, pip", node: "node, npm, npx", go: "go" };
type StateKey = DevEnvStatus["state"];
const STATE: Record<StateKey, { cls: string; text: string }> = {
  unknown: { cls: "", text: "Docker is not answering" },
  running: { cls: "ok", text: "running" },
  stopped: { cls: "", text: "stopped" },
  missing: { cls: "bad", text: "container missing" },
};

export function DevEnvBar({ tab, onChanged, onTerm }: { tab: Tab; onChanged: () => void; onTerm: (id: string) => void }) {
  const [env, setEnv] = useState<DevEnvStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [wizard, setWizard] = useState(false);
  const [busy, setBusy] = useState<"install" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");
  const latest = useRef(tab.id); // a slow response for the previous tab must not overwrite this one
  latest.current = tab.id;

  const load = useCallback(async () => {
    const id = tab.id;
    try {
      const status = await api.devenv(id);
      if (latest.current === id) (setEnv(status), setLoadError(""));
    } catch (e) {
      if (latest.current === id) (setEnv(null), setLoadError((e as Error).message));
    }
  }, [tab.id]);
  useEffect(() => void load(), [load]);
  const refresh = async () => {
    await load();
    onChanged();
  };

  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);

  if (loadError) return <div className="dk-envbar"><span className="faint" role="alert">{t("Could not check the dev container: {error}", { error: loadError })}</span></div>;
  if (!env) return null;
  const cfg = env.config;
  const state = env.state;
  const openWizard = () => setWizard(true);
  const wizardEl = wizard && <DevEnvWizard tab={tab} env={env} onClose={() => setWizard(false)} onDone={() => (setWizard(false), void refresh())} />;

  async function install() {
    setBusy("install");
    setErr("");
    try {
      onTerm((await api.installDeps(tab.id)).id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setConfirm(false);
    setBusy("remove");
    setErr("");
    try {
      await api.removeDevenv(tab.id);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (state === "unknown") {
    return (
      <div className="dk-envbar">
        <span className="pill">{t(STATE.unknown.text)}</span>
        <span className="faint mono">{env.container}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm" disabled={busy !== null} onClick={() => void refresh()}><RefreshCw size={14} /> {t("Retry")}</button>
        {env.error && <div className="errline dk-envbar-err" role="alert">{env.error}</div>}
      </div>
    );
  }
  if (!cfg) {
    return (
      <div className="dk-envbar">
        <span className="faint">{t("This project runs on your machine.")}</span>
        <button className="btn sm" onClick={openWizard}><Container size={14} /> {t("Create a dev container")}</button>
        {wizardEl}
      </div>
    );
  }
  const st = STATE[state] ?? STATE.unknown;
  return (
    <div className="dk-envbar">
      <span className="pill accent">{cfg.lang} {cfg.version}</span>
      <span className={`pill ${st.cls}`}>{t(st.text)}</span>
      <span className="faint mono">{env.container}</span>
      <span className="faint dk-note">{t("{shims} of this project run in the container", { shims: SHIMS[cfg.lang] })}</span>
      <span style={{ flex: 1 }} />
      <button className="btn sm" disabled={busy !== null || state !== "running"} aria-label={t("Install dependencies in the container")} title={t("Runs the dependency install inside the container, in a new terminal")} onClick={install}>
        {busy === "install" ? <span className="spin" /> : <PackageCheck size={14} />} {t("Install dependencies")}
      </button>
      <button className="btn sm ghost" disabled={busy !== null} aria-label={t("Recreate the dev container")} title={t("Create the container again (change language, version or ports)")} onClick={openWizard}><RefreshCw size={14} /> {t("Recreate")}</button>
      {confirm ? (
        <button className="btn sm danger armed" aria-label={t("Confirm: remove {name}", { name: env.container })} onClick={remove}>{t("Remove {name}?", { name: env.container })}</button>
      ) : (
        <button className="btn sm ghost danger" disabled={busy !== null} aria-label={t("Remove container {name}", { name: env.container })} title={t("Deletes the container and the command shims. Your code is not touched and .devcontainer/devcontainer.json stays in the repository.")} onClick={() => setConfirm(true)}>
          {busy === "remove" ? <span className="spin" /> : <Trash2 size={14} />} {t("Remove container")}
        </button>
      )}
      {err && <div className="errline dk-envbar-err" role="alert">{err}</div>}
      {wizardEl}
    </div>
  );
}
