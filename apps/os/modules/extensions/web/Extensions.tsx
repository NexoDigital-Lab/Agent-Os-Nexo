import { Check, ChevronRight, Download, Plus, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ago, usd } from "@os/lib/format";
import { extApi as api, type Ext, type ExtOverview, type ProjectExt } from "./api";
import { t } from "@os/i18n";

const EDITOR_ONLY = (id: string) => id.startsWith("agent-os.");
const VSCODE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Extensions: the general list (every project) and each project's own list + recommendations. You decide; nothing applies itself. */
export function Extensions() {
  const [data, setData] = useState<ExtOverview | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({}); // "install:<id>" | "claude:<p>" | "sync:<p>"

  const load = () => api.extensions().then(setData, (e) => setError(e.message));
  useEffect(() => void load(), []);

  if (!data) return <div className="page"><h1>{t("Extensions")}</h1>{error ? <div className="errline">{error}</div> : <p className="sub"><span className="spin" /> {t("Reading projects…")}</p>}</div>;

  const cat = new Map(data.catalog.map((e) => [e.id.toLowerCase(), e]));
  const installed = data.installed ? new Set(data.installed) : null;

  async function task(key: string, fn: () => Promise<unknown>) {
    setBusy((b) => ({ ...b, [key]: true }));
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }
  const setProject = (p: ProjectExt) => setData((d) => d && { ...d, projects: d.projects.map((x) => (x.name === p.name ? p : x)) });
  const saveProject = (p: ProjectExt, extensions: string[], dismissed = p.dismissed) =>
    task(`save:${p.name}`, async () => {
      setProject(await api.saveProjectExt(p.name, { extensions, dismissed }));
    });
  const saveGeneral = (general: string[]) =>
    task("general", async () => {
      await api.saveGeneralExt(general);
      await load(); // every project's recommendations and .vscode state depend on it
    });
  const install = (id: string) => task(`install:${id}`, async () => { await api.installExt(id); await load(); });

  const status = (id: string) => (
    <ExtStatus id={id} ext={cat.get(id.toLowerCase())} installed={installed} busy={!!busy[`install:${id}`]} onInstall={() => install(id)} />
  );
  const shown = data.projects.filter((p) => !q || `${p.name} ${p.stacks.map((s) => s.key).join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page ext-page">
      <h1>{t("Extensions")}</h1>
      <p className="sub">
        {t("General ones go in every project (library/extensions.json). Each project adds its own; recommendations are suggestions: you add, dismiss or install.")}{" "}
        {t("They are saved in the project's")} <span className="mono">context/extensions.json</span> {t("and reach the repository with")} <b>{t("Sync .vscode")}</b>.
        {!installed && <><br /><span style={{ color: "var(--bad)" }}>{t("The code command was not found: VS Code extensions can't be listed or installed.")}</span></>}
      </p>
      {error && <div className="errline" style={{ marginBottom: 12 }}>{error}</div>}

      <section className="card ext-card">
        <div className="ext-head">
          <h3>{t("General")} <span className="faint">· {t("every project")}</span></h3>
          <AddPicker catalog={data.catalog} exclude={data.general} onAdd={(id) => saveGeneral([...data.general, id])} />
        </div>
        {data.general.map((id) => (
          <ExtRow key={id} id={id} ext={cat.get(id.toLowerCase())} status={status(id)}>
            <button className="btn sm ghost" disabled={busy.general} title={t("Remove from the general list")} aria-label={t("Remove from the general list")} onClick={() => saveGeneral(data.general.filter((g) => g !== id))}><X size={14} /></button>
          </ExtRow>
        ))}
      </section>

      <div className="ext-bar">
        <input className="field" placeholder={t("Filter projects or stack (go, nest, next…)")} aria-label={t("Filter projects or stack (go, nest, next…)")} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="faint" style={{ fontSize: 12.5 }}>{t("{n} projects", { n: shown.length })}</span>
      </div>

      {shown.map((p) => {
        const nameOf = (id: string) => cat.get(id.toLowerCase())?.name ?? p.custom.find((c) => c.id === id)?.name;
        return (
          <details key={p.name} className="card ext-card ext-proj">
            <summary>
              <span className="caret"><ChevronRight size={14} /></span>
              <b>{p.name}</b>
              <span className="ext-stacks">
                {p.stacks.map((s) => <span key={s.key} className="pill" title={s.evidence}>{s.key}</span>)}
                {!p.stacks.length && <span className="faint" style={{ fontSize: 12 }}>{t("stack not detected")}</span>}
              </span>
              <span className="ext-counts faint">
                {t("{n} own", { n: p.extensions.length })}{p.recommended.length ? <> · <span style={{ color: "var(--accent-text)" }}>{t("{n} recommended", { n: p.recommended.length })}</span></> : null}
              </span>
            </summary>

            <div className="ext-tools">
              <VscodeState p={p} busy={!!busy[`sync:${p.name}`]} onSync={() => task(`sync:${p.name}`, async () => setProject(await api.syncVscode(p.name)))} />
              <button className="btn sm" disabled={busy[`claude:${p.name}`]} onClick={() => task(`claude:${p.name}`, async () => setProject(await api.recommendExt(p.name)))}>
                {busy[`claude:${p.name}`] ? <><span className="spin" /> {t("The AI is looking at the repository…")}</> : <><Sparkles size={14} /> {t("Recommend with AI")}</>}
              </button>
              {p.aiAt && <span className="faint" style={{ fontSize: 11.5 }}>{t("last: {when}", { when: ago(p.aiAt) })}{p.aiCost ? ` · ${usd(p.aiCost)}` : ""}</span>}
              <AddPicker catalog={data.catalog} exclude={[...data.general, ...p.extensions]} custom onAdd={(id) => saveProject(p, [...p.extensions, id], p.dismissed.filter((d) => d !== id))} />
            </div>

            <div className="eyebrow ext-sec">{t("In this project")}</div>
            {p.extensions.length === 0 && <div className="faint ext-empty">{t("None yet. Add one from the recommended ones or with")} <Plus size={13} /> {t("Add")}.</div>}
            {p.extensions.map((id) => (
              <ExtRow key={id} id={id} ext={cat.get(id.toLowerCase())} name={nameOf(id)} status={status(id)}>
                <button className="btn sm ghost" title={t("Remove from the project")} aria-label={t("Remove from the project")} onClick={() => saveProject(p, p.extensions.filter((x) => x !== id))}><X size={14} /></button>
              </ExtRow>
            ))}

            {p.recommended.length > 0 && <div className="eyebrow ext-sec">{t("Recommended")}</div>}
            {p.recommended.map((r) => (
              <ExtRow key={r.id} id={r.id} ext={cat.get(r.id.toLowerCase())} name={r.name} why={r.why} source={r.source} status={status(r.id)}>
                <button className="btn sm primary" onClick={() => saveProject(p, [...p.extensions, r.id])}><Plus size={14} /> {t("Add")}</button>
                <button className="btn sm ghost" title={t("Don't recommend it again")} onClick={() => saveProject(p, p.extensions, [...p.dismissed, r.id])}>{t("Dismiss")}</button>
              </ExtRow>
            ))}

            {p.dismissed.length > 0 && (
              <div className="ext-dismissed faint">
                {t("Dismissed:")}{" "}
                {p.dismissed.map((id) => (
                  <button key={id} className="linkish" title={t("Recommend it again")} onClick={() => saveProject(p, p.extensions, p.dismissed.filter((d) => d !== id))}>
                    {nameOf(id) ?? id} <RotateCcw size={12} />
                  </button>
                ))}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

function ExtRow({ id, ext, name, why, source, status, children }: {
  id: string; ext?: Ext; name?: string; why?: string; source?: "rules" | "ai"; status: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="ext-row">
      <div className="ext-main">
        <div className="ext-name">
          {ext?.name ? t(ext.name) : (name ?? id)}
          {source && <span className={`pill ${source === "ai" ? "info" : ""}`}>{source === "ai" ? <><Sparkles size={12} /> {t("AI")}</> : t("rules")}</span>}
        </div>
        <div className="ext-desc">{why ? <>→ {why.startsWith("found ") ? t("found {what}", { what: why.slice(6) }) : why}</> : ext?.desc ? t(ext.desc) : t("Not in the catalog.")}</div>
        <div className="ext-id mono faint">{EDITOR_ONLY(id) ? t("only in agent-os's editor") : id}</div>
      </div>
      {status}
      <div className="ext-actions">{children}</div>
    </div>
  );
}

function ExtStatus({ id, ext, installed, busy, onInstall }: { id: string; ext?: Ext; installed: Set<string> | null; busy: boolean; onInstall: () => void }) {
  const inCode = installed?.has(id.toLowerCase());
  return (
    <div className="ext-status">
      {EDITOR_ONLY(id) ? (
        <span className="faint" title={t("VS Code has it built in")}>VS Code —</span>
      ) : inCode ? (
        <span className="pill ok">VS Code <Check size={12} /></span>
      ) : installed ? (
        <button className="btn sm" disabled={busy} onClick={onInstall}>{busy ? <span className="spin" /> : <Download size={14} />} {t("Install")}</button>
      ) : null}
      {ext?.editor ? <span className="pill accent" title={t("Works inside agent-os's editor")}>editor <Check size={12} /></span> : <span className="faint" title={t("No equivalent in agent-os's editor")}>editor —</span>}
    </div>
  );
}

function VscodeState({ p, busy, onSync }: { p: ProjectExt; busy: boolean; onSync: () => void }) {
  if (p.vscode.invalid) return <span className="pill bad" title={t("The repository's .vscode/extensions.json is not valid JSON")}>{t(".vscode invalid")}</span>;
  const note = p.vscode.ignored ? ` ${t("(ignored by git: it stays on your machine)")}` : "";
  if (p.vscode.exists && p.vscode.inSync) return <span className="pill ok" title={`${t(".vscode/extensions.json is up to date")}${note}`}>.vscode <Check size={12} /></span>;
  return (
    <button className="btn sm ghost" disabled={busy} title={`${t("Writes general + own ones to the repository's .vscode/extensions.json")}${note}`} onClick={onSync}>
      {busy ? <span className="spin" /> : <RefreshCw size={14} />} {p.vscode.exists ? t("Sync .vscode (out of date)") : t("Create .vscode/extensions.json")}
    </button>
  );
}

/** Pick from the catalog, or (custom) type any Marketplace id. */
function AddPicker({ catalog, exclude, onAdd, custom }: { catalog: Ext[]; exclude: string[]; onAdd: (id: string) => void; custom?: boolean }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const skip = new Set(exclude.map((x) => x.toLowerCase()));
  const options = catalog.filter((e) => !skip.has(e.id.toLowerCase()));
  if (!open) return <button className="btn sm ghost ext-add" onClick={() => setOpen(true)}><Plus size={14} /> {t("Add")}</button>;
  return (
    <span className="ext-add ext-picker">
      <select className="field" aria-label={t("Pick from the catalog…")} autoFocus defaultValue="" onChange={(e) => { if (e.target.value) { onAdd(e.target.value); setOpen(false); } }}>
        <option value="" disabled>{t("Pick from the catalog…")}</option>
        {options.map((e) => <option key={e.id} value={e.id}>{e.name}{e.editor ? " · editor" : ""}</option>)}
      </select>
      {custom && (
        <form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); if (VSCODE_ID.test(id) && !skip.has(id.toLowerCase())) { onAdd(id.trim()); setOpen(false); setId(""); } }}>
          <input className="field mono" placeholder={t("or an id: publisher.name")} aria-label={t("or an id: publisher.name")} value={id} onChange={(e) => setId(e.target.value.trim())} />
        </form>
      )}
      <button className="btn sm ghost" aria-label={t("Close")} onClick={() => setOpen(false)}><X size={14} /></button>
    </span>
  );
}
