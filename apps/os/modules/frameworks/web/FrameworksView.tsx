// Settings → Frameworks: the third-party ways of working (a company's npm package, a community orchestrator…). Like
// the providers: add and enable them here, choose one in a chat tab's composer, or make one the default. Every change
// goes through `nexo framework`. Hooks run commands on every tool call: they show exactly and are approved with two
// confirmations.
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@os/i18n";
import { askConfirm } from "@os/lib/dialog";
import { ConfirmButton } from "@os/lib/ConfirmButton";
import { frameworksApi as api, type FrameworkInfo, type FrameworksList } from "./api";

const NEXO = "nexo";

export function FrameworksView() {
  const [state, setState] = useState<FrameworksList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const reqId = useRef(0); // only the latest list response may set state

  const load = useCallback(async () => {
    const n = ++reqId.current;
    try {
      const s = await api.list();
      if (n === reqId.current) setState(s);
    } catch (e) {
      if (n === reqId.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function apply(fn: () => Promise<FrameworksList>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      reqId.current++; // an older list response must not overwrite this one
      setState(await fn());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function approveHooks(fw: FrameworkInfo) {
    const ok = await askConfirm(
      t("{name} will run these commands on every tool call, with your permissions:", { name: fw.name }) + "\n\n" + fw.hookCommands.join("\n"),
      t("Approve hooks"),
      true,
    );
    if (ok) await apply(() => api.setHooks(fw.name, true, fw.hookCommands));
  }

  async function addFramework(e: React.FormEvent) {
    e.preventDefault();
    if (await apply(() => api.add(source.trim(), name.trim()))) {
      setSource("");
      setName("");
    }
  }

  if (!state) {
    return (
      <div className="page">
        <h1>{t("Frameworks")}</h1>
        {error ? <p className="errline" role="alert">{error}</p> : <p className="sub"><span className="spin" /> {t("Loading frameworks…")}</p>}
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{t("Frameworks")}</h1>
      <p className="sub">
        {t("A framework is a way of working that comes from outside (your company's, a community's). Enable it here, then choose it when you start a tab, like an AI. It never changes your permissions.")}
      </p>
      {error && (
        <div className="errline" role="alert">
          <span>{error}</span>
          <button className="linkish" aria-label={t("Dismiss the error")} onClick={() => setError("")}>{t("close")}</button>
        </div>
      )}
      <div className="card" style={{ marginBottom: 12 }}>
        <span className="eyebrow">{t("Default for new work")}</span>
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
          <input type="radio" name="fw-default" checked={state.default === NEXO} disabled={busy} onChange={() => void apply(() => api.setDefault(NEXO))} />
          <span>{t("Nexo (no framework)")}</span>
        </label>
      </div>
      {state.frameworks.length === 0 && <div className="faint" style={{ marginBottom: 12 }}>{t("No frameworks yet. Add one below.")}</div>}
      {state.frameworks.map((fw) => (
        <div key={fw.name} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="eyebrow">{fw.name}</span>
            <span className="pill info">{fw.kind === "tool" ? t("Tool") : t("Method")}</span>
            <span className={fw.enabled ? "pill ok" : "pill"}>{fw.enabled ? t("Enabled") : t("Off")}</span>
            {fw.isDefault && <span className="pill accent">{t("Default")}</span>}
            <span style={{ flex: 1 }} />
            <ConfirmButton
              title={t("Remove {name}", { name: fw.name })}
              confirmText={t("Remove {name}? Its files go (a folder you pointed to stays).", { name: fw.name })}
              disabled={busy}
              onConfirm={() => void apply(() => api.remove(fw.name))}
            >
              {t("Remove")}
            </ConfirmButton>
          </div>
          <div className="mono" style={{ marginTop: 8 }}>{fw.source} · {fw.version} · {fw.license}</div>
          <div className="faint" style={{ marginTop: 4, fontSize: 12 }}>
            {fw.managed === "external" ? t("A folder managed elsewhere: only referenced, never changed.") : t("Installed by Nexo at an exact version, without install scripts.")}
          </div>
          <div className="faint" style={{ marginTop: 4, fontSize: 12 }}>
            {t("{skills} skills · {agents} agents · {commands} commands · {mcp} MCP servers · {instructions} instruction files", {
              skills: fw.contributions.skills.length, agents: fw.contributions.agents.length, commands: fw.contributions.commands.length,
              mcp: fw.contributions.mcpServers.length, instructions: fw.contributions.instructions.length,
            })}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" role="switch" checked={fw.enabled} disabled={busy} onChange={() => void apply(() => api.setEnabled(fw.name, !fw.enabled))} />
              <span>{fw.kind === "tool" ? t("On") : t("Available to pick")}</span>
            </label>
            {fw.kind === "method" && fw.enabled && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="radio" name="fw-default" checked={fw.isDefault} disabled={busy} onChange={() => void apply(() => api.setDefault(fw.name))} />
                <span>{t("Use by default")}</span>
              </label>
            )}
          </div>
          {fw.hookCommands.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <span className={fw.hooksApproved ? "pill ok" : "pill bad"}>{fw.hooksApproved ? t("Hooks approved") : t("Hooks off")}</span>
              <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>{t("Hooks run these commands on every tool call:")}</div>
              <pre className="mono" style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{fw.hookCommands.join("\n")}</pre>
              {fw.hooksApproved ? (
                <button className="btn sm ghost" disabled={busy} onClick={() => void apply(() => api.setHooks(fw.name, false, fw.hookCommands))}>{t("Withdraw approval")}</button>
              ) : (
                <ConfirmButton
                  title={t("Approve the hooks of {name}", { name: fw.name })}
                  confirmText={t("Review the commands and approve")}
                  disabled={busy}
                  onConfirm={() => void approveHooks(fw)}
                >
                  {t("Approve hooks…")}
                </ConfirmButton>
              )}
            </div>
          )}
        </div>
      ))}
      {state.broken.length > 0 && (
        <div className="errline" role="alert">{t("Unreadable framework.json in: {names}", { names: state.broken.join(", ") })}</div>
      )}
      <form className="card" onSubmit={(e) => void addFramework(e)}>
        <span className="eyebrow">{t("Add a framework")}</span>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input
            className="field"
            style={{ flex: 1, minWidth: 260 }}
            value={source}
            maxLength={500}
            placeholder="npm:@corp/agents@1.4.0  |  path:/home/you/my-framework"
            aria-label={t("Source")}
            onChange={(e) => setSource(e.target.value)}
          />
          <input className="field" value={name} maxLength={64} placeholder={t("Name (optional)")} aria-label={t("Name (optional)")} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn primary" disabled={busy || !source.trim()}>
            {busy ? <span className="spin" /> : t("Add")}
          </button>
        </div>
        <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>
          {t("npm needs an exact version and runs without install scripts. It is added off: nothing changes until you enable it.")}
        </div>
      </form>
    </div>
  );
}
