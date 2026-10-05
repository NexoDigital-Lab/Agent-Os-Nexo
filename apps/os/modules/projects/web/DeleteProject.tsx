// You choose what goes; the warnings say what would be lost; typing the name confirms. Local things go to the trash.
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { projectsApi, type DeleteCheck } from "./api";

type What = "code" | "folder";

export function DeleteProject({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted: (steps: string[], gone: boolean) => void }) {
  const name = id.split("/").pop()!;
  const [c, setC] = useState<DeleteCheck | null>(null);
  const [local, setLocal] = useState<What | null>("folder");
  const [remote, setRemote] = useState(false);
  const [container, setContainer] = useState(false); // opt-in: otherwise it stays for the Docker view
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => void projectsApi.deleteCheck(id).then(setC, (e: Error) => setError(t(e.message))), [id]);

  const risks: string[] = [];
  if (c && local) {
    if (c.dirty) risks.push(t("{n} file(s) with uncommitted changes", { n: c.dirty }));
    if (c.unpushed) risks.push(t("{n} commit(s) not pushed", { n: c.unpushed }));
    if (c.unpushed === null) risks.push(t("the branch has no upstream: there may be commits that are on no remote"));
    if (c.stashes) risks.push(t("{n} stash(es)", { n: c.stashes }));
    if (local === "folder" && c.contextFiles) risks.push(t("{n} file(s) of context and secrets that exist only on this machine", { n: c.contextFiles }));
    if (c.openTabs) risks.push(t("{n} tab(s) of this project will close", { n: c.openTabs }));
  }
  const blocked = !!c && ((local !== null && c.worktrees.length > 0) || c.runningTabs > 0 || (remote && (!c.remoteIsMine || !c.canDeleteRemote)));
  const ready = !!c && !blocked && confirm === name && (local !== null || remote) && !busy;

  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Delete {name}", { name: id })}
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError("");
          try {
            const r = await projectsApi.remove(id, { code: local === "code", folder: local === "folder", remote, container: local !== null && container, confirm });
            onDeleted(r.steps, r.gone);
          } catch (x) {
            setError(t((x as Error).message));
            setBusy(false);
          }
        }}
      >
        <h3>{t("Delete {name}", { name: id })}</h3>
        {!c && !error && <p className="faint" style={{ margin: 0, fontSize: 13 }}><span className="spin" /> {t("Checking the project…")}</p>}
        {c && (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("Choose what goes. Local files go to the trash (recoverable).")}</p>
            <label className="del-opt">
              <input type="radio" name="del-local" checked={local === "folder"} onChange={() => setLocal("folder")} />
              <span><b>{t("The whole project")}</b> <span className="mono faint">projects/{id}/</span> <span className="faint">— {t("code, context, secrets and AI files")}</span></span>
            </label>
            <label className="del-opt">
              <input type="radio" name="del-local" checked={local === "code"} onChange={() => setLocal("code")} />
              <span><b>{t("Only the code")}</b> <span className="mono faint">projects/{id}/code/</span> <span className="faint">— {t("keeps the context to clone it again later")}</span></span>
            </label>
            <label className="del-opt">
              <input type="radio" name="del-local" checked={local === null} onChange={() => setLocal(null)} />
              <span>{t("Nothing local")}</span>
            </label>
            <label className={`del-opt ${c.remote ? "" : "off"}`}>
              <input type="checkbox" disabled={!c.remote} checked={remote} onChange={(e) => setRemote(e.target.checked)} />
              <span>
                <b>{t("GitHub repository")}</b> <span className="mono faint">{c.remote ?? t("— none")}</span>
                {c.remote && <span style={{ color: "var(--bad)" }}> — {t("irreversible: issues, PRs and everything go with it")}</span>}
              </span>
            </label>
            {c.container && (
              <label className={`del-opt ${local ? "" : "off"}`}>
                <input type="checkbox" disabled={!local} checked={container} onChange={(e) => setContainer(e.target.checked)} />
                <span>{t("Also remove its dev container")} <span className="mono faint">{c.container}</span></span>
              </label>
            )}
            {risks.length > 0 && (
              <div className="del-warn">
                <b>{t("Will be lost:")}</b>
                <ul>{risks.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            {local && c.worktrees.length > 0 && <div className="errline">{t("It has worktrees ({list}): delete them first, or they break.", { list: c.worktrees.join(", ") })}</div>}
            {c.runningTabs > 0 && <div className="errline">{t("{n} tab(s) of this project are working: stop them first.", { n: c.runningTabs })}</div>}
            {remote && !c.remoteIsMine && <div className="errline">{t("{repo} is not in your account: it can't be deleted from here.", { repo: c.remote ?? "" })}</div>}
            {remote && c.remoteIsMine && !c.canDeleteRemote && (
              <div className="errline">
                {t("Your gh token can't delete repositories. Run this in a terminal and open this again:")} <span className="mono">gh auth refresh -h github.com -s delete_repo</span>
              </div>
            )}
            <label className="eyebrow" htmlFor="del-confirm">{t("Type {name} to confirm", { name })}</label>
            <input id="del-confirm" className="field mono" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={name} />
          </>
        )}
        {error && <div className="errline">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
          <button className="btn danger" disabled={!ready}>{busy ? <><span className="spin" /> {t("Deleting…")}</> : <><Trash2 size={14} /> {t("Delete")}</>}</button>
        </div>
      </form>
    </div>
  );
}
