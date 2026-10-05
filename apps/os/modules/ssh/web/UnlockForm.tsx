// Master-password prompt for the SSH vault. Shared by the rail view and the in-tab console (when a 401 locked arrives).
import { useEffect, useId, useRef, useState } from "react";
import { LockOpen } from "lucide-react";
import { t } from "@os/i18n";
import { sshApi } from "./api";

export function UnlockForm({ onUnlocked, compact }: { onUnlocked: () => void; compact?: boolean }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!error) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [error]);

  async function submit() {
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await sshApi.unlock(password);
      setPassword("");
      onUnlocked();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className={`ssh-unlock ${compact ? "compact" : "card"}`} onSubmit={(e) => (e.preventDefault(), submit())}>
      <h2 className="ssh-h">{t("The SSH vault is locked")}</h2>
      <p className="faint" style={{ margin: 0, fontSize: 13 }}>{t("Enter the master password to see your accesses and use the console.")}</p>
      <label className="eyebrow" htmlFor={`${uid}-pw`}>{t("Master password")}</label>
      <input ref={inputRef} id={`${uid}-pw`} className="field" type="password" autoFocus autoComplete="current-password" value={password} readOnly={busy} aria-invalid={!!error} aria-describedby={error ? `${uid}-err` : undefined} onChange={(e) => setPassword(e.target.value)} />
      {error && <span id={`${uid}-err`} className="errline" role="alert">{t(error)}</span>}
      <div>
        <button className="btn primary" disabled={!password || busy}>{busy ? <span className="spin" /> : <LockOpen size={14} />} {t("Unlock")}</button>
      </div>
    </form>
  );
}
