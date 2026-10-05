// Settings → Modules: every module found in modules/ with its state. Changes apply on the next start,
// like a new build; core modules can't be turned off.
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { ApiError, hostApi, type ModuleRow } from "@os/lib/http";

export function ModuleManager() {
  const [rows, setRows] = useState<ModuleRow[] | null>(null);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const load = () => hostApi.modules().then(setRows, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function toggle(row: ModuleRow) {
    setError("");
    try {
      await hostApi.setModule(row.id, !row.enabled);
      setChanged(true);
      await load();
    } catch (e) {
      setError(t((e as ApiError).message));
    }
  }

  if (!rows) return <div className="faint">{error || t("Loading…")}</div>;
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return (
    <div className="modules">
      {changed && <div className="pill accent">{t("Restart agent-os to apply the changes.")}</div>}
      {error && <div className="pill bad" role="alert">{error}</div>}
      <table className="modules-table">
        <thead>
          <tr><th>{t("Module")}</th><th>{t("Version")}</th><th>{t("Depends on")}</th><th>{t("State")}</th></tr>
        </thead>
        <tbody>
          {ordered.map((m) => (
            <tr key={m.id} className={m.parent ? "sub" : ""}>
              <td>
                <b>{m.parent ? `↳ ${m.name}` : m.name}</b>
                <div className="faint">{t(m.description)}</div>
                {m.error && <div className="errline" role="alert">{t("Did not load: {error}", { error: m.error })}</div>}
              </td>
              <td className="num">{m.version}</td>
              <td className="faint mono">{m.dependsOn.join(", ") || "—"}</td>
              <td>
                {m.core ? (
                  <span className="pill">{t("core")}</span>
                ) : (
                  <label className="switch">
                    <input type="checkbox" checked={m.enabled} onChange={() => void toggle(m)} aria-label={t("Enable {name}", { name: m.name })} />
                    <span>{m.enabled ? (m.active ? t("on") : t("on after restart")) : m.active ? t("off after restart") : t("off")}</span>
                  </label>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
