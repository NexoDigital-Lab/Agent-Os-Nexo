// Modal that creates (or recreates) the project's dev container and writes .devcontainer/devcontainer.json.
import { useEffect, useId, useRef, useState } from "react";
import { Container } from "lucide-react";
import { t } from "@os/i18n";
import type { Tab } from "../../sessions/web/api";
import { dockerApi as api, type DevEnvStatus, type Lang } from "./api";

const DEFAULT_VERSION: Record<Lang, string> = { python: "3.12", node: "22", go: "1.23" };
const DEFAULT_PORTS: Record<Lang, string> = { python: "8000", node: "3000,5173", go: "8080" };
const IMAGE: Record<Lang, (v: string) => string> = { python: (v) => `python:${v}-bookworm`, node: (v) => `node:${v}-bookworm`, go: (v) => `golang:${v}-bookworm` };
const VERSION = /^\d+(\.\d+){0,2}$/;

const parsePorts = (raw: string) => raw.split(",").map((p) => p.trim()).filter(Boolean);
const portsOk = (list: string[]) => list.every((p) => /^\d+$/.test(p) && +p >= 1 && +p <= 65535);

export function DevEnvWizard({ tab, env, onClose, onDone }: { tab: Tab; env: DevEnvStatus | null; onClose: () => void; onDone: () => void }) {
  const detected = env?.detected ?? [];
  const cfg = env?.config;
  const start = cfg?.lang ?? detected[0]?.lang ?? "python";
  const found = (l: Lang) => detected.find((d) => d.lang === l);
  const [lang, setLang] = useState<Lang>(start);
  const [version, setVersion] = useState(cfg?.version ?? found(start)?.version ?? DEFAULT_VERSION[start]);
  const [ports, setPorts] = useState(cfg ? cfg.ports.join(",") : DEFAULT_PORTS[start]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recreate = !!cfg;
  const uid = useId();
  const titleId = `${uid}-title`;
  const modalRef = useRef<HTMLFormElement>(null);
  const langRef = useRef<HTMLSelectElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Restore focus to whatever opened the dialog when it closes.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    langRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const pickLang = (l: Lang) => {
    setLang(l);
    setVersion(found(l)?.version ?? DEFAULT_VERSION[l]);
    setPorts(DEFAULT_PORTS[l]);
  };

  const portList = parsePorts(ports);
  const versionOk = VERSION.test(version);
  const valid = versionOk && portsOk(portList);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!busy) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;
      const items = [...modalRef.current.querySelectorAll<HTMLElement>("select, input, button, [href], [tabindex]:not([tabindex='-1'])")].filter((el) => !(el as HTMLInputElement).disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || !modalRef.current.contains(cur))) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && (cur === last || !modalRef.current.contains(cur))) (e.preventDefault(), first.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      await api.createDevenv(tab.id, { lang, version, ports: portList.map(Number) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const evidence = found(lang);
  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <form ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), valid && !busy && create())}>
        <h3 id={titleId}>{recreate ? t("Recreate container · {project}", { project: tab.project }) : t("Dev container · {project}", { project: tab.project })}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t("The project folder is mounted in the container at the same path. What you type in this tab's terminals (python, pip, node…) and what the agent runs is executed inside: nothing gets installed on your machine.")}{" "}
          {t("If the repository has no .devcontainer/devcontainer.json yet, one is written so VS Code can open it too; if it has one, it is left alone.")}
        </p>
        {recreate && <p className="dk-warn">{t("Replaces the current container: what you installed inside (pip/npm) is lost and has to be installed again. Your code is not touched.")}</p>}
        <label className="eyebrow" htmlFor={`${uid}-lang`}>{t("Language")}</label>
        <select ref={langRef} autoFocus id={`${uid}-lang`} className="field" value={lang} disabled={busy} onChange={(e) => pickLang(e.target.value as Lang)}>
          <option value="python">Python</option>
          <option value="node">Node</option>
          <option value="go">Go</option>
        </select>
        {evidence && <span className="faint" style={{ fontSize: 12 }}>{t("Detected: {version} in {evidence}", { version: evidence.version, evidence: evidence.evidence })}</span>}
        <label className="eyebrow" htmlFor={`${uid}-ver`}>{t("Version")}</label>
        <input id={`${uid}-ver`} className="field mono" value={version} disabled={busy} onChange={(e) => setVersion(e.target.value.trim())} />
        {!versionOk && <span className="errline">{t("Use a number like 3.12 or 22.")}</span>}
        <label className="eyebrow" htmlFor={`${uid}-ports`}>{t("Ports (comma separated)")}</label>
        <input id={`${uid}-ports`} className="field mono" value={ports} disabled={busy} onChange={(e) => setPorts(e.target.value)} />
        {!portsOk(portList) && <span className="errline">{t("Each port has to be an integer between 1 and 65535.")}</span>}
        <span className="faint" style={{ fontSize: 12 }}>{t("Image:")} <span className="mono">{versionOk ? IMAGE[lang](version) : "—"}</span></span>
        {busy && <span className="muted" aria-live="polite" style={{ fontSize: 13 }}><span className="spin" /> {t("Pulling the image and creating the container… the first time it can take a few minutes (it can't be closed meanwhile)")}</span>}
        {error && <span className="errline" role="alert">{t("Could not create the container: {error}. Check that Docker is running.", { error })}</span>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
          <button className="btn primary" disabled={!valid || busy}><Container size={14} /> {recreate ? t("Recreate container") : t("Create container")}</button>
        </div>
      </form>
    </div>
  );
}
