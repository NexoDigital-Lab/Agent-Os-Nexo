// "Containers" section of the Docker view: list, filter and per-row actions.
import { useState } from "react";
import { Play, RotateCw, ScrollText, Square, SquareTerminal } from "lucide-react";
import { t } from "@os/i18n";
import { ConfirmDelete } from "@os/lib/ConfirmDelete";
import { dockerApi as api, type Container, type ContainerAction } from "./api";

const statePill = (c: Container) => {
  if (c.state === "running") return "ok";
  if (c.state === "paused") return "info";
  return /^Exited \((?!0\))/.test(c.status) ? "bad" : ""; // non-zero exit code = it crashed
};

export function DockerContainers({ containers, reload, busyRef, onLogs, onShell, fail }: {
  containers: Container[];
  reload: () => Promise<unknown>;
  busyRef: { current: Set<string> }; // rows with an action in flight: the auto-refresh waits for them
  onLogs: (c: Container) => void;
  onShell: (c: Container) => void;
  fail: (msg: string) => void;
}) {
  const [onlyActive, setOnlyActive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = containers
    .filter((c) => !onlyActive || c.state === "running")
    .sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || a.name.localeCompare(b.name));

  async function act(c: Container, action: ContainerAction) {
    setBusy(c.id);
    busyRef.current.add(c.id);
    try {
      await api.containerAction(c.id, action);
      await reload();
    } catch (e) {
      fail((e as Error).message);
    } finally {
      busyRef.current.delete(c.id);
      setBusy(null);
    }
  }

  return (
    <section className="dk-section">
      <div className="dk-section-head">
        <h2>{t("Containers")}</h2>
        <div className="seg">
          <button className={!onlyActive ? "on" : ""} aria-pressed={!onlyActive} onClick={() => setOnlyActive(false)}>{t("All::containers")}</button>
          <button className={onlyActive ? "on" : ""} aria-pressed={onlyActive} onClick={() => setOnlyActive(true)}>{t("Running")}</button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="empty">{onlyActive ? t("No running containers.") : t("No containers.")}</p>
      ) : (
        <div className="dk-rows">
          {shown.map((c) => {
            const running = c.state === "running";
            const loading = busy === c.id;
            return (
              <div key={c.id} className="dk-row dk-ctr">
                <span className="dk-name">
                  <span className="mono" title={c.name}>{c.name}</span>
                  {c.project && <span className="pill accent">dev · {c.project}</span>}
                </span>
                <span className="faint dk-trunc" title={c.image}>{c.image}</span>
                <span><span className={`pill ${statePill(c)}`}>{c.state}</span></span>
                <span className="faint dk-trunc" title={c.status}>{c.status}</span>
                <span className="faint mono dk-trunc" title={c.ports}>{c.ports || "—"}</span>
                <span className="dk-actions">
                  {loading ? (
                    <span className="spin" role="status" aria-label={t("Working on {name}", { name: c.name })} />
                  ) : (
                    <>
                      <button className="btn sm ghost" title={running ? t("Stop::container") : t("Start")} aria-label={running ? t("Stop {name}", { name: c.name }) : t("Start {name}", { name: c.name })} onClick={() => act(c, running ? "stop" : "start")}>
                        {running ? <Square size={14} /> : <Play size={14} />}
                      </button>
                      <button className="btn sm ghost" title={t("Restart")} aria-label={t("Restart {name}", { name: c.name })} onClick={() => act(c, "restart")}><RotateCw size={14} /></button>
                      <button className="btn sm ghost" title={t("View logs")} aria-label={t("View the logs of {name}", { name: c.name })} onClick={() => onLogs(c)}><ScrollText size={14} /></button>
                      {running && <button className="btn sm ghost" title={t("Open a terminal inside")} aria-label={t("Open a terminal inside {name}", { name: c.name })} onClick={() => onShell(c)}><SquareTerminal size={14} /></button>}
                      <ConfirmDelete
                        title={t("Delete container")}
                        name={c.name}
                        note={c.project ? t("Deletes the container and the shims of {project}; your code is not touched", { project: c.project }) : undefined}
                        onConfirm={() => act(c, "rm")} />
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
