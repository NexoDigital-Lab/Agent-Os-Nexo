// Settings → Versions: your builds of agent-os. Picking one only decides what the next start loads.
import { useEffect, useState } from "react";
import { locale, t } from "@os/i18n";
import { versionsApi, type BuildsState } from "./api";

export function Versions() {
  const [s, setS] = useState<BuildsState | null>(null);
  const [error, setError] = useState("");
  useEffect(() => void versionsApi.state().then(setS, (e: Error) => setError(e.message)), []);
  const choose = (v: string | null) => versionsApi.pin(v).then(setS, (e: Error) => setError(e.message));

  if (!s) return <div className="faint">{error || t("Loading…")}</div>;
  return (
    <div className="versions">
      <p className="faint" style={{ margin: 0 }}>
        {s.running === "source"
          ? t("This is the preview of os/source. Approve it to make a new build.")
          : t("Running {v}. Changes you approve become a new build; agent-os never restarts on its own.", { v: s.running })}
      </p>
      {error && <div className="pill bad" role="alert">{error}</div>}
      {s.builds.length === 0 ? (
        <div className="faint">{t("No builds yet.")}</div>
      ) : (
        <ul className="versions-list">
          {s.builds.map((b) => (
            <li key={b.version} className={b.version === s.next ? "next" : ""}>
              <span className="num">{b.version}</span>
              {b.version === s.running && <span className="pill ok">{t("running")}</span>}
              {b.version === s.next && b.version !== s.running && <span className="pill accent">{t("loads on next start")}</span>}
              {b.version === s.pinned && <span className="pill">{t("pinned")}</span>}
              <span className="faint">{b.builtAt ? new Date(b.builtAt).toLocaleString(locale()) : ""}</span>
              <span className="versions-notes">{b.notes ?? ""}</span>
              {b.version !== s.next && <button className="btn sm" onClick={() => void choose(b.version)}>{t("Load this one next")}</button>}
            </li>
          ))}
        </ul>
      )}
      {s.pinned && <button className="btn sm ghost" onClick={() => void choose(null)}>{t("Always load the newest")}</button>}
    </div>
  );
}
