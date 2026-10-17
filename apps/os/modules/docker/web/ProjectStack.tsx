// "Docker" tab view: the project's own stack. What its compose files declare, how it starts (start profiles saved in
// the project's context/docker.json), one start / stop / restart button with live status, and logs per service.
// Detection runs when the view opens or on refresh; status is polled every few seconds only while the view is open.
// The server decides what needs a confirmation (production-looking profile, remote engine, a stack asking for more
// than its repo) and says why; the view shows that reason and resends with confirm.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Database, Pencil, Play, RefreshCw, RotateCw, ScrollText, Square } from "lucide-react";
import { t } from "@os/i18n";
import type { TabViewProps } from "../../sessions/web/slots";
import { dockerApi as api, type StackAction, type StackConfig, type StackInfo, type StackStatus } from "./api";
import { ProfileEditor } from "./ProfileEditor";

const POLL_MS = 3000;
const STOPPED = [0, 130, 137, 143]; // exit codes of a stopped container, not a failed one (as on the server)
type Shown = StackStatus["state"] | "no-docker";
const STATE: Record<Shown, { cls: string; text: string }> = {
  stopped: { cls: "", text: "stopped" },
  starting: { cls: "accent", text: "starting…" },
  stopping: { cls: "accent", text: "stopping…" },
  running: { cls: "ok", text: "running" },
  partial: { cls: "dkp-warn", text: "partly running" },
  error: { cls: "bad", text: "failed" },
  "no-docker": { cls: "bad", text: "Docker is not running" },
};

export function ProjectStack({ tab }: TabViewProps) {
  const [info, setInfo] = useState<StackInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [profile, setProfile] = useState("");
  const [status, setStatus] = useState<StackStatus | null>(null);
  const [noDocker, setNoDocker] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState<{ action: StackAction; reason: string } | null>(null);
  const [actError, setActError] = useState("");
  const [logs, setLogs] = useState<{ service: string; text: string } | null>(null);
  // Slow responses for a previous tab or profile must not land on the current one.
  const latest = useRef({ tab: tab.id, profile });
  latest.current = { tab: tab.id, profile };
  const polling = useRef(false);

  const load = useCallback(async () => {
    const id = tab.id;
    try {
      const next = await api.stack(id);
      if (latest.current.tab !== id) return;
      setInfo(next);
      setLoadError("");
      setProfile((p) => (next.config && Object.hasOwn(next.config.profiles, p) ? p : next.config?.default ?? ""));
    } catch (e) {
      if (latest.current.tab === id) setLoadError((e as Error).message);
    }
  }, [tab.id]);
  useEffect(() => {
    setInfo(null);
    setStatus(null);
    setProfile("");
    setEditing(false);
    setAsk(null);
    setActError("");
    setLogs(null);
    void load();
  }, [load]);

  const poll = useCallback(async () => {
    if (!profile || polling.current) return; // compose ps can be slower than the interval: never stack them
    polling.current = true;
    const want = { tab: tab.id, profile };
    try {
      const st = await api.stackStatus(want.tab, want.profile);
      if (latest.current.tab === want.tab && latest.current.profile === want.profile) (setStatus(st), setNoDocker(false), setStatusError(""));
    } catch (e) {
      if (latest.current.tab !== want.tab || latest.current.profile !== want.profile) return;
      const down = (e as { status?: number }).status === 503;
      setNoDocker(down);
      setStatusError(down ? "" : (e as Error).message);
    } finally {
      polling.current = false;
    }
  }, [tab.id, profile]);
  useEffect(() => {
    if (!info?.config || !profile) return;
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [info?.config, profile, poll]);

  if (loadError) {
    return (
      <div className="dkp">
        <div className="errline" role="alert">{t("Could not read this project's Docker setup: {error}", { error: loadError })}</div>
        <button className="btn sm" onClick={() => void load()}><RefreshCw size={14} /> {t("Retry")}</button>
      </div>
    );
  }
  if (!info) return <div className="dkp faint"><span className="spin" /> {t("Reading the compose files…")}</div>;

  const config = info.config;
  const save = async (next: StackConfig) => {
    await api.saveStack(tab.id, next);
    setEditing(false);
    await load();
    setProfile(next.default);
  };

  async function run(action: StackAction, confirm = false) {
    setAsk(null);
    setActError("");
    try {
      await api.stackAction(tab.id, action, profile, confirm);
      await poll();
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409 && err.message.startsWith("Confirm to continue")) setAsk({ action, reason: err.message });
      else setActError(err.message);
    }
  }

  async function showLogs(service: string) {
    try {
      setLogs({ service, text: (await api.stackLogs(tab.id, profile, service)).text || t("(no output)") });
    } catch (e) {
      setLogs({ service, text: (e as Error).message });
    }
  }

  const header = (
    <div className="dkp-head">
      <h2>{t("Docker · {project}", { project: tab.project ?? "" })}</h2>
      {!info.local && <span className="pill bad" title={t("The active Docker context points at another machine: starting or stopping acts there.")}>{t("remote Docker context")}</span>}
      <span style={{ flex: 1 }} />
      <button className="btn sm ghost" aria-label={t("Read the compose files again")} onClick={() => void load()}><RefreshCw size={14} /> {t("Refresh")}</button>
    </div>
  );

  const fileErrors = info.detection.compose.filter((c) => c.error);
  const errorsEl = fileErrors.length > 0 && (
    <div className="dkp-section">
      {fileErrors.map((c) => <div key={c.file} className="errline" role="alert">{t("{file}: {error}", { file: c.file, error: c.error ?? "" })}</div>)}
    </div>
  );

  if (!info.detection.compose.length) {
    return (
      <div className="dkp">
        {header}
        <p className="faint">{t("This project has no compose file (docker-compose.yml, compose.yaml…) up to three folders deep.")}</p>
        {info.detection.dockerfiles.length > 0 && <p className="faint">{t("Dockerfiles found: {files}", { files: info.detection.dockerfiles.join(", ") })}</p>}
      </div>
    );
  }

  if (!config || editing) {
    const start = config ?? info.proposed;
    return (
      <div className="dkp">
        {header}
        {errorsEl}
        <p className="faint">{config ? t("Edit how this project starts.") : t("Define once how this project starts. It is saved in the project's context/docker.json.")}</p>
        {start ? (
          <ProfileEditor detection={info.detection} initial={start} prodIds={info.prod} onSave={save} onCancel={config ? () => setEditing(false) : undefined} />
        ) : (
          <p className="faint">{t("No compose file could be read, so there is nothing to start yet.")}</p>
        )}
      </div>
    );
  }

  const p = config.profiles[profile];
  const shownState: Shown | null = noDocker ? "no-docker" : status?.state ?? null;
  const st = shownState ? STATE[shownState] : null;
  const busy = !!status?.busy || noDocker;
  const declared = info.detection.compose.filter((c) => p?.files.includes(c.file)).flatMap((c) => c.services);
  const shown = declared.filter((s) => !p?.services.length || p.services.includes(s.name));
  const button = (action: StackAction, icon: ReactNode, label: string) => (
    <button className={`btn sm ${action === "up" ? "primary" : ""}`} disabled={busy} onClick={() => void run(action)}>{icon} {t(label)}</button>
  );

  return (
    <div className="dkp">
      {header}
      {errorsEl}
      <div className="dkp-card">
        <label className="dkp-profile">
          <span className="faint">{t("Start profile")}</span>
          <select className="field" value={profile} onChange={(e) => (setProfile(e.target.value), setStatus(null), setAsk(null), setLogs(null))}>
            {Object.entries(config.profiles).map(([id, pr]) => <option key={id} value={id}>{pr.label || id}{id === config.default ? ` · ${t("default")}` : ""}</option>)}
          </select>
        </label>
        {info.prod.includes(profile) && <span className="pill bad">{t("production")}</span>}
        {st ? <span className={`pill ${st.cls}`}>{t(st.text)}</span> : <span className="spin" />}
        <span className="faint mono">-p {p?.projectName}</span>
        <span style={{ flex: 1 }} />
        {button("up", status?.busy === "up" ? <span className="spin" /> : <Play size={14} />, "Start")}
        {button("restart", status?.busy === "restart" ? <span className="spin" /> : <RotateCw size={14} />, "Restart")}
        {button("stop", status?.busy === "stop" ? <span className="spin" /> : <Square size={14} />, p?.stop === "down" ? "Stop and remove containers" : "Stop::stack")}
        <button className="btn sm ghost" aria-label={t("Edit the start profiles")} onClick={() => setEditing(true)}><Pencil size={14} /></button>
      </div>
      {ask && (
        <div className="dkp-card dkp-ask" role="alert">
          <span>{ask.reason}</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={() => setAsk(null)}>{t("Cancel")}</button>
          <button className="btn sm danger armed" onClick={() => void run(ask.action, true)}>{t("Confirm and continue")}</button>
        </div>
      )}
      {(actError || status?.lastError || statusError) && <div className="errline" role="alert">{actError || status?.lastError || statusError}</div>}

      <div className="dk-rows dkp-services">
        {shown.map((s) => {
          const live = status?.services.find((r) => r.service === s.name);
          const ports = (live?.ports.length ? live.ports : s.ports).map((x) => (x.published ? `${x.published}→${x.target}` : String(x.target))).join(", ");
          return (
            <div key={s.name} className="dk-row dkp-row">
              <span className="dk-name">{s.kind === "db" && <Database size={14} aria-label={t("database")} />}<span className="mono">{s.name}</span>{s.kind === "db" && <span className="pill accent">{s.engine}</span>}{s.kind === "db-ui" && <span className="pill">{t("DB UI")}</span>}</span>
              <span className="dk-trunc faint mono">{s.image ?? t("built from the repo")}</span>
              <span className="dk-trunc mono">{ports}</span>
              <span>{live ? <span className={`pill ${live.state === "running" ? (live.health === "unhealthy" ? "dkp-warn" : "ok") : STOPPED.includes(live.exitCode) ? "" : "bad"}`}>{live.health ? `${live.state} · ${live.health}` : live.state}</span> : <span className="faint">{t("not created")}</span>}</span>
              <span className="dk-actions"><button className="btn sm ghost" disabled={!live} aria-label={t("Logs of {service}", { service: s.name })} onClick={() => void showLogs(s.name)}><ScrollText size={14} /> {t("Logs")}</button></span>
            </div>
          );
        })}
      </div>

      {info.stacks.length > 0 && (
        <p className="faint dkp-note">{t("Compose projects of this repository in Docker: {list}", { list: info.stacks.map((s) => `${s.name} (${s.status})`).join(", ") })}</p>
      )}

      {logs && (
        <div className="dkp-logs">
          <div className="dkp-head">
            <strong className="mono">{logs.service}</strong>
            <span style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={() => void showLogs(logs.service)}><RefreshCw size={14} /> {t("Refresh")}</button>
            <button className="btn sm ghost" onClick={() => setLogs(null)}>{t("Close")}</button>
          </div>
          <pre>{logs.text}</pre>
        </div>
      )}
    </div>
  );
}
