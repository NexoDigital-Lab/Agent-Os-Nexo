// providers: one card per AI provider — detect status, install/login hints, enable + default choice.
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@os/i18n";
import { providersApi as api, type ProviderId, type ProvidersState } from "./api";

export function ProvidersView() {
  const [state, setState] = useState<ProvidersState | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null); // the Test button currently running
  const [saving, setSaving] = useState(false);
  const fail = useCallback((msg: string) => setError(msg), []);
  const reqId = useRef(0); // only the latest list response may set state

  const load = useCallback(async (onErr: (msg: string) => void) => {
    const n = ++reqId.current;
    try {
      const s = await api.list();
      if (n === reqId.current) setState(s);
    } catch (e) {
      if (n === reqId.current) onErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(fail);
  }, [load, fail]);

  async function saveEnabled(enabled: ProviderId[], def: ProviderId | null) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      setState(await api.setEnabled(enabled, def));
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function toggleEnabled(id: ProviderId) {
    if (!state) return;
    const enabled = state.enabled.includes(id) ? state.enabled.filter((x) => x !== id) : [...state.enabled, id];
    if (!enabled.length) {
      fail(t("Keep at least one provider enabled."));
      return;
    }
    const def = state.default && enabled.includes(state.default) ? state.default : (enabled[0] ?? null);
    void saveEnabled(enabled, def);
  }

  function pickDefault(id: ProviderId) {
    if (!state || !state.enabled.includes(id)) return;
    void saveEnabled(state.enabled, id);
  }

  async function testOne(id: ProviderId) {
    if (busyId) return;
    setBusyId(id);
    setError("");
    try {
      const { provider } = await api.testProvider(id);
      setState((s) => (s ? { ...s, providers: s.providers.map((p) => (p.id === id ? provider : p)) } : s));
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!state) {
    return (
      <div className="page">
        <h1>{t("Providers")}</h1>
        <p className="sub">{error || <><span className="spin" /> {t("Detecting providers…")}</>}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{t("Providers")}</h1>
      <p className="sub">{t("Choose which AI providers agent-os-nexo uses. Each CLI keeps its own login.")}</p>
      {error && (
        <div className="errline" role="alert">
          <span>{error}</span>
          <button className="linkish" aria-label={t("Dismiss the error")} onClick={() => setError("")}>{t("close")}</button>
        </div>
      )}
      {state.providers.length === 0 && <div className="faint">{t("No providers registered.")}</div>}
      {state.providers.map((p) => {
        const enabled = state.enabled.includes(p.id);
        const isDefault = state.default === p.id;
        const governed = state.governed.includes(p.id);
        return (
          <div key={p.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="eyebrow">{p.label}</span>
              <span className={p.found ? "pill ok" : "pill bad"}>
                {p.found ? t("Available") : t("Not available")}
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="btn sm ghost"
                disabled={busyId !== null || saving}
                title={t("Test")}
                aria-label={t("Test {name}", { name: p.label })}
                onClick={() => void testOne(p.id)}
              >
                {busyId === p.id ? <span className="spin" /> : t("Test")}
              </button>
            </div>
            <div className="mono" style={{ marginTop: 8 }}>
              {p.found ? (p.version ?? t("No version")) : <span className="faint">{p.install}</span>}
            </div>
            <div className="faint" style={{ marginTop: 4, fontSize: 12 }}>{p.loginHint}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={saving || busyId !== null || !governed}
                  onChange={() => toggleEnabled(p.id)}
                />
                <span>{t("Enabled")}</span>
              </label>
              {enabled && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="providers-default"
                    checked={isDefault}
                    disabled={saving || busyId !== null}
                    onChange={() => pickDefault(p.id)}
                  />
                  <span>{t("Use by default")}</span>
                </label>
              )}
            </div>
            {!governed && (
              <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>
                {t("Turn it on in environment.config.json → tools and run nexo update first, so it runs under your Nexo permissions.")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
