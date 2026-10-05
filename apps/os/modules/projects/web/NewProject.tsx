// "+ Project": create a new one, or clone one of your GitHub repositories. Both make the full project
// (AGENTS.md, code/, context/, secrets/) through the nexo CLI, optionally inside a <ws>-ws workspace.
import { Check, Download, Globe, Lock, Plus, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { ago } from "@os/lib/format";
import { projectsApi, type Created, type RemoteRepo } from "./api";
import { refreshProjects, useProjects } from "./store";

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const slug = (v: string) => v.toLowerCase().replace(/\s+/g, "-");

type Props = { onClose: () => void; onDone: (created: Created, setup: boolean) => void };

export function NewProject(props: Props) {
  const [mode, setMode] = useState<"create" | "clone">("create");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-bg" onClick={() => !busy && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("New project")} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3>{t("New project")}</h3>
          <div className="seg">
            <button type="button" disabled={busy} className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}><Plus size={14} /> {t("Create")}</button>
            <button type="button" disabled={busy} className={mode === "clone" ? "on" : ""} onClick={() => setMode("clone")}><Download size={14} /> {t("Clone")}</button>
          </div>
        </div>
        {mode === "create" ? <CreatePane {...props} busy={busy} setBusy={setBusy} /> : <ClonePane {...props} busy={busy} setBusy={setBusy} />}
      </div>
    </div>
  );
}

type Pane = Props & { busy: boolean; setBusy: (b: boolean) => void };

function DoneView({ done, onClose, onOpen }: { done: Created; onClose: () => void; onOpen: () => void }) {
  return (
    <>
      <ul className="checks" style={{ color: "var(--ok)" }}>{done.steps.map((s) => <li key={s}>{s}</li>)}</ul>
      {done.url && <a className="mono" style={{ color: "var(--accent-text)", fontSize: 13 }} href={done.url} target="_blank" rel="noreferrer">{done.url}</a>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t("Close")}</button>
        <button type="button" className="btn primary" onClick={onOpen}><WandSparkles size={14} /> {t("Open and set up")}</button>
      </div>
    </>
  );
}

/** Optional workspace: projects that belong together (api + web) share a <ws>-ws folder and its context. */
function WorkspaceField({ ws, setWs, disabled }: { ws: string; setWs: (v: string) => void; disabled: boolean }) {
  const known = [...new Set(useProjects().map((p) => p.workspace).filter((w): w is string => !!w))];
  return (
    <>
      <label className="eyebrow" htmlFor="np-ws">{t("Workspace (optional)")}</label>
      <input id="np-ws" className="field mono" list="np-ws-list" disabled={disabled} placeholder={t("none")} value={ws} onChange={(e) => setWs(slug(e.target.value))} />
      <datalist id="np-ws-list">{known.map((w) => <option key={w} value={w} />)}</datalist>
    </>
  );
}

const finish = async (props: Props, done: Created) => {
  await refreshProjects();
  props.onDone(done, true);
};

function CreatePane(props: Pane) {
  const { onClose, busy, setBusy } = props;
  const [name, setName] = useState("");
  const [ws, setWs] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [remote, setRemote] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Created | null>(null);
  const valid = NAME.test(name) && (!ws || NAME.test(ws));
  const shown = name || t("<name>");
  const where = ws ? `${ws}-ws/${shown}` : shown;

  if (done) return <DoneView done={done} onClose={onClose} onOpen={() => void finish(props, done)} />;
  return (
    <form
      style={{ display: "contents" }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        setError("");
        try {
          setDone(await projectsApi.create({ name, ws: ws || undefined, description, visibility, remote }));
          void refreshProjects();
        } catch (x) {
          setError(t((x as Error).message));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="eyebrow" htmlFor="np-name">{t("Name (folder and repository)")}</label>
      <input id="np-name" autoFocus className="field mono" placeholder="my-project" value={name} onChange={(e) => setName(slug(e.target.value))} />
      {name && !NAME.test(name) && <div className="errline">{t("Only lowercase letters, digits, dot, dash and underscore.")}</div>}
      <WorkspaceField ws={ws} setWs={setWs} disabled={busy} />
      <label className="eyebrow" htmlFor="np-desc">{t("Description")}</label>
      <textarea id="np-desc" className="field" rows={2} placeholder={t("What it is, in one line")} value={description} onChange={(e) => setDescription(e.target.value)} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
        <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        {t("Create the repository on GitHub and push it")}
      </label>
      {remote && (
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          <button type="button" className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}><Lock size={14} /> {t("Private")}</button>
          <button type="button" className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}><Globe size={14} /> {t("Public")}</button>
        </div>
      )}
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        {t("Creates projects/{where} with AGENTS.md, context/ and code/ (README, .gitignore and the first commit).", { where })}
        {remote ? ` ${visibility === "public" ? t("Also a public repository in your GitHub account.") : t("Also a private repository in your GitHub account.")}` : ""}
      </p>
      {error && <div className="errline">{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
        <button className="btn primary" disabled={!valid || busy}>{busy ? <><span className="spin" /> {t("Creating…")}</> : <><Plus size={14} /> {t("Create project")}</>}</button>
      </div>
    </form>
  );
}

function ClonePane(props: Pane) {
  const { onClose, busy, setBusy } = props;
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null);
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [ws, setWs] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Created | null>(null);

  useEffect(() => void projectsApi.remoteRepos().then(setRepos, (x: Error) => setError(t(x.message))), []);

  const q = filter.trim().toLowerCase();
  const shown = (repos ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  const name = pick?.split("/")[1]?.toLowerCase() ?? "<repo>";
  const where = ws ? `${ws}-ws/${name}` : name;

  if (done) return <DoneView done={done} onClose={onClose} onOpen={() => void finish(props, done)} />;
  return (
    <form
      style={{ display: "contents" }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!pick || busy || (ws && !NAME.test(ws))) return;
        setBusy(true);
        setError("");
        try {
          setDone(await projectsApi.clone({ repo: pick, ws: ws || undefined }));
          void refreshProjects();
        } catch (x) {
          setError(t((x as Error).message));
        } finally {
          setBusy(false);
        }
      }}
    >
      <input autoFocus className="field" placeholder={t("Filter your repositories…")} aria-label={t("Filter your repositories…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="repo-list">
        {!repos && !error && <div className="faint" style={{ padding: 12, fontSize: 13 }}><span className="spin" /> {t("Loading your GitHub repositories…")}</div>}
        {repos && shown.length === 0 && <div className="faint" style={{ padding: 12, fontSize: 13 }}>{t("No repository matches.")}</div>}
        {shown.map((r) => (
          <label key={r.full} className={`repo ${r.cloned ? "off" : ""} ${pick === r.full ? "on" : ""}`} title={r.full}>
            <input type="radio" name="repo" disabled={r.cloned || busy} checked={pick === r.full} onChange={() => setPick(r.full)} style={{ accentColor: "var(--accent)" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="rn">
                <span>{r.name}</span>
                {r.fork && <span className="pill">fork</span>}
                {r.archived && <span className="pill">{t("archived")}</span>}
              </div>
              {r.description && <div className="rd">{r.description}</div>}
            </div>
            <span className="rm">{r.cloned ? <><Check size={12} /> {t("already here")}</> : <>{r.private ? <Lock size={12} /> : <Globe size={12} />} {ago(r.pushedAt)}</>}</span>
          </label>
        ))}
      </div>
      <WorkspaceField ws={ws} setWs={setWs} disabled={busy} />
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        {t("Clones into projects/{where}/code with its context ready. Then the setup assistant opens: toolchains, dependencies, .env, extensions and, optionally, nexo-onboard for the context.", { where })}
      </p>
      {error && <div className="errline">{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
        <button className="btn primary" disabled={!pick || busy}>{busy ? <><span className="spin" /> {t("Cloning…")}</> : <><Download size={14} /> {t("Clone")}</>}</button>
      </div>
    </form>
  );
}
