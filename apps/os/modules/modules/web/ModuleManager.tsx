// Modules: every module found in modules/ as a card with its state and a switch. Changes apply on the next start,
// like a new build; core modules can't be turned off, and a switch says why when a dependency blocks it.
import { Lock, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { ApiError, hostApi, type ModuleRow } from "@os/lib/http";
import { RestartButton } from "@os/lib/RestartButton";
import { SUMMARIES, iconFor } from "./summaries";

type Filter = "all" | "on" | "off" | "pending";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All::modules" },
  { id: "on", label: "On::modules" },
  { id: "off", label: "Off::modules" },
  { id: "pending", label: "Pending restart" },
];

const pending = (m: ModuleRow) => m.enabled !== m.active;
/** The card's one-liner: the short summary when there is one, else the manifest description. */
const summaryOf = (m: ModuleRow) => t(SUMMARIES[m.id] ?? m.description);

/** Why the switch can't move right now, or null. Mirrors setEnabled() on the server, which has the last word. */
function blocker(m: ModuleRow, rows: ModuleRow[]): string | null {
  if (m.core) return t("Core module: always on");
  if (m.enabled) {
    const users = rows.filter((r) => r.enabled && r.parent !== m.id && r.dependsOn.includes(m.id)).map((r) => r.name);
    return users.length ? t("Used by {names}: turn them off first", { names: users.join(", ") }) : null;
  }
  // A submodule also needs its parent (the server counts it as a dependency).
  const missing = [...(m.parent ? [m.parent] : []), ...m.dependsOn].filter((d) => !rows.find((r) => r.id === d)?.enabled);
  return missing.length ? t("Needs {names}: turn them on first", { names: missing.join(", ") }) : null;
}

function status(m: ModuleRow): { label: string; tone: string } {
  if (m.error) return { label: t("Did not load"), tone: "bad" };
  if (m.core) return { label: t("core"), tone: "" };
  if (m.enabled && m.active) return { label: t("on"), tone: "ok" };
  if (m.enabled) return { label: t("on after restart"), tone: "accent" };
  if (m.active) return { label: t("off after restart"), tone: "accent" };
  return { label: t("off"), tone: "" };
}

export function ModuleManager() {
  const [rows, setRows] = useState<ModuleRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const load = () => hostApi.modules().then(setRows, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function set(ids: { id: string; enabled: boolean }[]) {
    setError("");
    setBusy(ids.map((i) => i.id).join(","));
    try {
      for (const { id, enabled } of ids) await hostApi.setModule(id, enabled);
    } catch (e) {
      setError(t((e as ApiError).message));
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (!rows) return <div className="page"><h1>{t("Modules")}</h1><p className="sub">{error || t("Loading…")}</p></div>;

  const changes = rows.filter(pending);
  // Undo in load order: re-enable dependencies before the modules that need them, then turn off dependents first.
  const undo = () => set([
    ...changes.filter((m) => m.active).map((m) => ({ id: m.id, enabled: true })),
    ...changes.filter((m) => !m.active).reverse().map((m) => ({ id: m.id, enabled: false })),
  ]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((m) => {
    if (filter === "on" && !m.enabled) return false;
    if (filter === "off" && m.enabled) return false;
    if (filter === "pending" && !pending(m)) return false;
    if (!needle) return true;
    return [m.id, m.name, m.description, summaryOf(m)].some((s) => s.toLowerCase().includes(needle));
  });
  const groups: { title: string; items: ModuleRow[] }[] = [
    { title: t("Core"), items: shown.filter((m) => m.core) },
    { title: t("In the rail"), items: shown.filter((m) => !m.core && !m.parent && m.nav) },
    { title: t("Features::modules"), items: shown.filter((m) => !m.core && !m.parent && !m.nav) },
    ...[...new Set(shown.filter((m) => m.parent).map((m) => m.parent ?? ""))].map((parent) => ({
      title: t("Inside {name}", { name: rows.find((r) => r.id === parent)?.name ?? parent }),
      items: shown.filter((m) => m.parent === parent),
    })),
  ].filter((g) => g.items.length);
  const on = rows.filter((m) => m.active).length;
  const failed = rows.filter((m) => m.error).length;

  return (
    <div className="page mm">
      <h1>{t("Modules")}</h1>
      <p className="sub">
        {t("{on} of {total} running", { on, total: rows.length })}
        {failed > 0 && <> · <span className="mm-bad">{t("{n} did not load", { n: failed })}</span></>}
        {" · "}{t("Changes apply when you restart agent-os-nexo.")}
      </p>

      {changes.length > 0 && (
        <div className="mm-pending" role="status">
          <span>{t("{n} change(s) waiting for a restart: {names}", { n: changes.length, names: changes.map((m) => m.name).join(", ") })}</span>
          <span className="mm-actions">
            <button className="btn sm" disabled={busy !== null} onClick={() => void undo()}><RotateCcw size={13} /> {t("Undo changes")}</button>
            <RestartButton />
          </span>
        </div>
      )}
      {error && <div className="mm-error" role="alert"><TriangleAlert size={14} /> {error}</div>}

      <div className="mm-bar">
        <label className="mm-search">
          <Search size={14} />
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search modules")} aria-label={t("Search modules")} />
        </label>
        <div className="mm-filters" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
              {t(f.label)}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 && <div className="empty">{t("No module matches.")}</div>}
      {groups.map((g) => (
        <section key={g.title} className="mm-group">
          <div className="eyebrow">{g.title} · {g.items.length}</div>
          <div className="mm-grid">
            {g.items.map((m) => {
              const Icon = iconFor(m.id);
              const why = blocker(m, rows);
              const st = status(m);
              const users = rows.filter((r) => r.parent !== m.id && r.dependsOn.includes(m.id)).map((r) => r.name);
              return (
                <article key={m.id} className={`mm-card${m.enabled ? "" : " off"}${m.error ? " failed" : ""}`}>
                  <header>
                    <span className="mm-icon"><Icon size={16} /></span>
                    <div className="mm-title">
                      <b>{m.name}</b>
                      <span className="faint mono">v{m.version}</span>
                    </div>
                    {m.core ? (
                      <span className="mm-lock" title={why ?? ""}><Lock size={13} /></span>
                    ) : (
                      <button
                        role="switch"
                        aria-checked={m.enabled}
                        aria-label={t("Enable {name}", { name: m.name })}
                        title={why ?? (m.enabled ? t("Turn off") : t("Turn on"))}
                        className={`mm-switch${m.enabled ? " on" : ""}`}
                        disabled={busy !== null || why !== null}
                        onClick={() => void set([{ id: m.id, enabled: !m.enabled }])}
                      >
                        <span />
                      </button>
                    )}
                  </header>
                  <p className="mm-summary" title={t(m.description)}>{summaryOf(m)}</p>
                  <footer>
                    <span className={`pill ${st.tone}`}>{st.label}</span>
                    {m.dependsOn.length > 0 && <span className="faint">{t("needs {names}", { names: m.dependsOn.join(", ") })}</span>}
                    {users.length > 0 && <span className="faint">{t("used by {names}", { names: users.join(", ") })}</span>}
                  </footer>
                  {m.error && <div className="errline" role="alert">{m.error}</div>}
                  {why && !m.core && <div className="mm-why">{why}</div>}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
