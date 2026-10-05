// Rail view "SSH": the encrypted vault of saved hosts. Setup / unlock / host list + form.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { KeyRound, Lock, Pencil, Plus, TerminalSquare, TriangleAlert } from "lucide-react";
import { t } from "@os/i18n";
import { ConfirmDelete } from "@os/lib/ConfirmDelete";
import { isLocked } from "@os/lib/http";
import { useProjects } from "../../projects/web/store";
import { focusTab, refreshTabs } from "../../sessions/web/tabs/store";
import { sshApi as api, type SshAuth, type SshHost, type SshHostInput, type VaultState } from "./api";
import { UnlockForm } from "./UnlockForm";

type ProjectRef = { id: string };

const AUTH_LABEL: Record<SshAuth, string> = { password: "Password", key: "Key", local: "My keys" };
const HOST_RE = /^[A-Za-z0-9.:-]+$/;
const USER_RE = /^[A-Za-z0-9._-]+$/;
const MIN_PW = 12; // same minimum as the server (server/index.ts)

export function SshView() {
  const projects = useProjects();
  const onOpened = async (tabId: string) => {
    await refreshTabs();
    focusTab(tabId);
  };
  const [state, setState] = useState<VaultState | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    api.state().then((r) => setState(r.state)).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="page ssh-page">
      <div className="dk-top">
        <div>
          <h1>{t("SSH accesses")}</h1>
          <p className="sub">{t("Save your servers encrypted with a master password and open them as a tab. The agent never sees the credentials.")}</p>
        </div>
        {state === "unlocked" && (
          <button className="btn" onClick={() => api.lock().then(load).catch((e) => setError((e as Error).message))}><Lock size={14} /> {t("Lock")}</button>
        )}
      </div>
      {error && <div className="errline" role="alert">{error}</div>}
      {state === null && !error && <div className="empty"><span className="spin" /></div>}
      {state === "setup" && <SetupForm onDone={load} />}
      {state === "locked" && <UnlockForm onUnlocked={load} />}
      {state === "unlocked" && <Hosts projects={projects} onLocked={() => setState("locked")} onOpened={onOpened} />}
    </div>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uid = useId();
  const longEnough = pw.length >= MIN_PW;
  const match = pw === pw2;
  const valid = longEnough && match;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.setup(pw);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card ssh-unlock" onSubmit={(e) => (e.preventDefault(), submit())}>
      <h2 className="ssh-h">{t("Create your master password")}</h2>
      <p className="ssh-warn"><TriangleAlert size={14} aria-hidden="true" /> <span>{t("If you forget it, it cannot be recovered: you would have to delete the vault and add every access again.")}</span></p>
      <label className="eyebrow" htmlFor={`${uid}-a`}>{t("Master password (at least {n} characters)", { n: MIN_PW })}</label>
      <input id={`${uid}-a`} className="field" type="password" autoFocus autoComplete="new-password" value={pw} disabled={busy} onChange={(e) => setPw(e.target.value)} />
      {pw && !longEnough && <span className="errline">{t("{n} more characters needed.", { n: MIN_PW - pw.length })}</span>}
      <label className="eyebrow" htmlFor={`${uid}-b`}>{t("Repeat it")}</label>
      <input id={`${uid}-b`} className="field" type="password" autoComplete="new-password" value={pw2} disabled={busy} onChange={(e) => setPw2(e.target.value)} />
      {pw2 && !match && <span className="errline">{t("They don't match.")}</span>}
      {error && <span className="errline" role="alert">{error}</span>}
      <div>
        <button className="btn primary" disabled={!valid || busy}>{busy ? <span className="spin" /> : <KeyRound size={14} />} {t("Create vault")}</button>
      </div>
    </form>
  );
}

function Hosts({ projects, onLocked, onOpened }: { projects: ProjectRef[]; onLocked: () => void; onOpened: (tabId: string) => void | Promise<void> }) {
  const [hosts, setHosts] = useState<SshHost[] | null>(null);
  const [editing, setEditing] = useState<SshHost | "new" | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => (isLocked(e) ? onLocked() : setError((e as Error).message)), [onLocked]);
  const load = useCallback(() => api.hosts().then(setHosts).catch(fail), [fail]);
  useEffect(() => void load(), [load]);

  async function open(h: SshHost) {
    setOpening(h.id);
    setError("");
    try {
      const { tabId } = await api.open(h.id);
      await onOpened(tabId);
    } catch (e) {
      fail(e);
    } finally {
      setOpening(null);
    }
  }

  return (
    <>
      <div className="dk-section-head">
        <h2>{t("Servers")}</h2>
        <button className="btn primary sm" onClick={() => setEditing("new")}><Plus size={14} /> {t("New access")}</button>
      </div>
      {error && <div className="errline" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
      {hosts === null ? (
        <div className="empty"><span className="spin" /></div>
      ) : hosts.length === 0 ? (
        <div className="empty ssh-empty">
          <KeyRound size={22} aria-hidden="true" />
          <div>{t("You haven't saved any access yet.")}</div>
          <button className="btn primary sm" onClick={() => setEditing("new")}><Plus size={14} /> {t("New access")}</button>
        </div>
      ) : (
        <ul className="ssh-hosts" aria-label={t("Saved accesses")}>
          {hosts.map((h) => (
            <li key={h.id} className="card ssh-host">
              <div className="ssh-host-main">
                <div className="ssh-host-name">{h.name}</div>
                <div className="mono faint ssh-host-addr">{h.user}@{h.host}:{h.port}</div>
              </div>
              <div className="ssh-host-pills">
                <span className="pill info">{t(AUTH_LABEL[h.auth])}</span>
                {h.project && <span className="pill accent">{h.project}</span>}
              </div>
              <div className="ssh-host-actions">
                <button className="btn primary sm" disabled={opening !== null} onClick={() => open(h)}>
                  {opening === h.id ? <span className="spin" /> : <TerminalSquare size={14} />} {t("Open session")}
                </button>
                <button className="btn sm ghost" onClick={() => setEditing(h)} aria-label={t("Edit {name}", { name: h.name })}><Pencil size={14} /> {t("Edit")}</button>
                <ConfirmDelete title={t("Delete access")} name={h.name} onConfirm={() => api.deleteHost(h.id).then(load).catch(fail)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <HostForm
          host={editing === "new" ? null : editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), load())}
          onLocked={onLocked}
        />
      )}
    </>
  );
}

function HostForm({ host, projects, onClose, onSaved, onLocked }: {
  host: SshHost | null;
  projects: ProjectRef[];
  onClose: () => void;
  onSaved: () => void;
  onLocked: () => void;
}) {
  const [name, setName] = useState(host?.name ?? "");
  const [addr, setAddr] = useState(host?.host ?? "");
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [user, setUser] = useState(host?.user ?? "");
  const [auth, setAuth] = useState<SshAuth>(host?.auth ?? "password");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [replaceSecret, setReplaceSecret] = useState(!host?.hasSecret);
  const [replacePass, setReplacePass] = useState(!host?.hasPassphrase);
  const [project, setProject] = useState(host?.project ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uid = useId();
  const modalRef = useRef<HTMLFormElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!busy) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !modalRef.current) return;
      const items = [...modalRef.current.querySelectorAll<HTMLElement>("select, input, textarea, button, [tabindex]:not([tabindex='-1'])")].filter((el) => !(el as HTMLInputElement).disabled);
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

  const portNum = Number(port);
  const nameErr = name.trim().length < 1 || name.trim().length > 60 ? t("The name must have between 1 and 60 characters.") : "";
  const hostErr = !addr || !HOST_RE.test(addr) || addr.startsWith("-") ? t("Use only letters, numbers, dot, hyphen or colon; it cannot start with a hyphen.") : "";
  const portErr = !/^\d+$/.test(port) || portNum < 1 || portNum > 65535 ? t("The port is an integer between 1 and 65535.") : "";
  const userErr = !user || !USER_RE.test(user) || user.startsWith("-") ? t("Use only letters, numbers, dot, hyphen or underscore; it cannot start with a hyphen.") : "";
  const hadSecretForAuth = !!host?.hasSecret && host.auth === auth;
  const needsSecret = auth !== "local" && !hadSecretForAuth && !secret; // creating (or switching auth type) needs the credential
  const valid = !nameErr && !hostErr && !portErr && !userErr && !needsSecret;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const body: SshHostInput = { name: name.trim(), host: addr, port: portNum, user, auth, project: project || null };
    if (auth === "local") {
      body.secret = "";
      body.passphrase = "";
    } else {
      if (secret) body.secret = secret;
      if (auth === "key" && passphrase) body.passphrase = passphrase;
      if (auth === "password") body.passphrase = "";
    }
    try {
      if (host) await api.updateHost(host.id, body);
      else await api.createHost(body);
      onSaved();
    } catch (e) {
      if (isLocked(e)) return onLocked();
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const titleId = `${uid}-title`;
  const showSecretInput = auth !== "local" && (replaceSecret || !hadSecretForAuth);
  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <form ref={modalRef} className="modal ssh-form" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), save())}>
        <h3 id={titleId}>{host ? t("Edit {name}", { name: host.name }) : t("New SSH access")}</h3>

        <label className="eyebrow" htmlFor={`${uid}-name`}>{t("Name")}</label>
        <input ref={firstRef} id={`${uid}-name`} className="field" value={name} disabled={busy} placeholder={t("Production")} onChange={(e) => setName(e.target.value)} />
        {name && nameErr && <span className="errline">{nameErr}</span>}

        <div className="ssh-row">
          <div className="ssh-grow">
            <label className="eyebrow" htmlFor={`${uid}-host`}>{t("Server")}</label>
            <input id={`${uid}-host`} className="field mono" value={addr} disabled={busy} placeholder={t("example.com or 10.0.0.5")} autoCapitalize="off" spellCheck={false} onChange={(e) => setAddr(e.target.value.trim())} />
          </div>
          <div className="ssh-port">
            <label className="eyebrow" htmlFor={`${uid}-port`}>{t("Port")}</label>
            <input id={`${uid}-port`} className="field mono" inputMode="numeric" value={port} disabled={busy} onChange={(e) => setPort(e.target.value.trim())} />
          </div>
        </div>
        {addr && hostErr && <span className="errline">{hostErr}</span>}
        {portErr && <span className="errline">{portErr}</span>}

        <label className="eyebrow" htmlFor={`${uid}-user`}>{t("User")}</label>
        <input id={`${uid}-user`} className="field mono" value={user} disabled={busy} autoCapitalize="off" spellCheck={false} onChange={(e) => setUser(e.target.value.trim())} />
        {user && userErr && <span className="errline">{userErr}</span>}

        <label className="eyebrow" htmlFor={`${uid}-auth`}>{t("Authentication")}</label>
        <select id={`${uid}-auth`} className="field" value={auth} disabled={busy} onChange={(e) => setAuth(e.target.value as SshAuth)}>
          <option value="password">{t("Password")}</option>
          <option value="key">{t("Private key")}</option>
          <option value="local">{t("My keys (~/.ssh and agent)")}</option>
        </select>
        {auth === "local" && <span className="faint" style={{ fontSize: 12 }}>{t("Nothing is stored: your local keys and the SSH agent are used.")}</span>}

        {auth !== "local" && hadSecretForAuth && !replaceSecret && (
          <div className="ssh-saved">
            <span className="pill ok">{t("Stored")}</span>
            <span className="faint" style={{ fontSize: 12.5 }}>{auth === "password" ? t("Password saved, not shown.") : t("Private key saved, not shown.")}</span>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setReplaceSecret(true)}>{t("Replace")}</button>
          </div>
        )}
        {showSecretInput && auth === "password" && (
          <>
            <label className="eyebrow" htmlFor={`${uid}-secret`}>{hadSecretForAuth ? t("New password") : t("Password")}</label>
            <input id={`${uid}-secret`} className="field" type="password" autoComplete="new-password" value={secret} disabled={busy} onChange={(e) => setSecret(e.target.value)} />
          </>
        )}
        {showSecretInput && auth === "key" && (
          <>
            <label className="eyebrow" htmlFor={`${uid}-secret`}>{hadSecretForAuth ? t("New private key") : t("Private key")}</label>
            <textarea id={`${uid}-secret`} className="field mono ssh-key" rows={6} value={secret} disabled={busy} spellCheck={false} autoComplete="off" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" onChange={(e) => setSecret(e.target.value)} />
          </>
        )}
        {auth === "key" && host?.hasPassphrase && host.auth === "key" && !replacePass ? (
          <div className="ssh-saved">
            <span className="pill ok">{t("Stored")}</span>
            <span className="faint" style={{ fontSize: 12.5 }}>{t("Key passphrase saved.")}</span>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setReplacePass(true)}>{t("Replace")}</button>
          </div>
        ) : (
          auth === "key" && (
            <>
              <label className="eyebrow" htmlFor={`${uid}-pass`}>{t("Key passphrase (optional)")}</label>
              <input id={`${uid}-pass`} className="field" type="password" autoComplete="new-password" value={passphrase} disabled={busy} onChange={(e) => setPassphrase(e.target.value)} />
            </>
          )
        )}

        <label className="eyebrow" htmlFor={`${uid}-proj`}>{t("Project (optional)")}</label>
        <select id={`${uid}-proj`} className="field" value={project} disabled={busy} onChange={(e) => setProject(e.target.value)}>
          <option value="">{t("None")}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>

        {needsSecret && <span className="faint" style={{ fontSize: 12 }}>{auth === "password" ? t("Enter the password to be able to save.") : t("Enter the private key to be able to save.")}</span>}
        {error && <span className="errline" role="alert">{error}</span>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
          <button className="btn primary" disabled={!valid || busy}>{busy && <span className="spin" />} {t("Save")}</button>
        </div>
      </form>
    </div>
  );
}
