import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Cloud, GitBranch, Minus, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FileIcon } from "../../../web/icons";
import { editorApi as api, type Branch, type Change, type ScmStatus, type Tab } from "../../../web/api";
import { t } from "@os/i18n";

/** Source Control in the editor sidebar, VS Code style: stage → commit → push, branches, stash, conflicts. */
export function SourceControl({ tab, onOpenDiff, onOpenFile, onCount, refreshKey }: {
  tab: Tab;
  onOpenDiff: (path: string, staged: boolean) => void;
  onOpenFile: (path: string) => void;
  onCount: (n: number) => void;
  refreshKey: number; // bumps after saves so the list follows your edits
}) {
  const [s, setS] = useState<ScmStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [newBranch, setNewBranch] = useState("");

  const apply = (st: ScmStatus) => {
    setS(st);
    onCount(st.staged.length + st.unstaged.length + st.untracked.length + st.conflicts.length);
  };
  const load = () => api.scm(tab.id).then(apply, (e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // edits from the terminal or Claude show up too
    return () => clearInterval(t);
  }, [tab.id]);
  useEffect(() => void load(), [refreshKey]);

  async function act(key: string, fn: () => Promise<ScmStatus>) {
    setBusy(key);
    setError("");
    try {
      apply(await fn());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  if (!s) return <div className="faint" style={{ padding: 12, fontSize: 13 }}>{error || <><span className="spin" /> {t("Reading git…")}</>}</div>;

  const nothingStaged = s.staged.length === 0;
  const dirty = s.unstaged.length + s.untracked.length > 0;
  const canCommit = (msg.trim() || amend) && (!nothingStaged || dirty || amend) && !s.conflicts.length;

  const row = (c: Change, kind: "staged" | "unstaged" | "untracked" | "conflict") => (
    <div key={kind + c.path} className="scm-row" title={`${c.path} · ${t(c.label)}${c.from ? ` (${t("from {path}", { path: c.from })})` : ""}`} onClick={() => (kind === "conflict" ? onOpenFile(c.path) : c.code === "D" ? null : kind === "untracked" ? onOpenFile(c.path) : onOpenDiff(c.path, kind === "staged"))}>
      <FileIcon name={c.path.split("/").pop()!} />
      <span className="nm">{c.path.split("/").pop()}</span>
      <span className="dir faint">{c.path.split("/").slice(0, -1).join("/")}</span>
      <span className="scm-acts" onClick={(e) => e.stopPropagation()}>
        {kind === "conflict" ? (
          <>
            <button title={t("Keep mine (ours)")} onClick={() => act("res", () => api.scmResolve(tab.id, c.path, "ours"))}>{t("mine")}</button>
            <button title={t("Keep theirs")} onClick={() => act("res", () => api.scmResolve(tab.id, c.path, "theirs"))}>{t("theirs")}</button>
            <button title={t("I resolved it by hand: mark it resolved")} onClick={() => act("res", () => api.scmResolve(tab.id, c.path, "manual"))}><Check size={14} /></button>
          </>
        ) : kind === "staged" ? (
          <button title={t("Unstage")} onClick={() => act("u", () => api.scmUnstage(tab.id, [c.path]))}><Minus size={14} /></button>
        ) : (
          <>
            <button
              title={kind === "untracked" ? t("Move to the trash") : t("Discard changes (back to the last commit)")}
              onClick={() => confirm(kind === "untracked" ? t("Move {path} to the trash?", { path: c.path }) : t("Discard the changes to {path}? It can't be undone.", { path: c.path })) && act("d", () => api.scmDiscard(tab.id, [c.path]))}
            ><Undo2 size={14} /></button>
            <button title={t("Stage")} onClick={() => act("s", () => api.scmStage(tab.id, [c.path]))}><Plus size={14} /></button>
          </>
        )}
      </span>
      <span className={`scm-code c-${c.code === "?" ? "U" : c.code}`}>{c.code === "?" ? "U" : c.code}</span>
    </div>
  );

  return (
    <div className="scm">
      <div className="scm-branch">
        <button className="linkish" title={t("Switch or create a branch")} onClick={() => (branches ? setBranches(null) : api.scmBranches(tab.id).then(setBranches, (e) => setError(e.message)))}>
          <GitBranch size={14} /> {s.branch ?? "(detached)"} <ChevronDown size={14} />
        </button>
        <span className="faint" title={s.upstream ? t("against {upstream}", { upstream: s.upstream }) : t("no upstream: the first push creates it")}>
          {s.upstream ? `↑${s.ahead} ↓${s.behind}` : t("no upstream")}
        </span>
        <span className="scm-sync">
          <button disabled={!!busy} title={t("Get changes from the remote (fetch)")} onClick={() => act("fetch", () => api.scmSync(tab.id, "fetch"))}>{busy === "fetch" ? <span className="spin" /> : <RefreshCw size={14} />}</button>
          <button disabled={!!busy} title={t("Pull::git")} aria-label={t("Pull::git")} onClick={() => act("pull", () => api.scmSync(tab.id, "pull"))}>{busy === "pull" ? <span className="spin" /> : <ArrowDown size={14} />}</button>
          <button disabled={!!busy} title={s.upstream ? "Push" : t("Push (creates the upstream on origin)")} onClick={() => act("push", () => api.scmSync(tab.id, "push"))}>{busy === "push" ? <span className="spin" /> : <ArrowUp size={14} />}</button>
        </span>
      </div>

      {branches && (
        <div className="scm-branches">
          <form onSubmit={(e) => { e.preventDefault(); if (newBranch.trim()) act("co", () => api.scmCheckout(tab.id, newBranch.trim(), true)).then(() => { setNewBranch(""); setBranches(null); }); }}>
            <input className="field mono" placeholder={t("new branch… (Enter)")} value={newBranch} onChange={(e) => setNewBranch(e.target.value.replace(/\s+/g, "-"))} />
          </form>
          {branches.map((b) => (
            <button key={b.name} className={b.current ? "on" : ""} disabled={b.current} onClick={() => act("co", () => api.scmCheckout(tab.id, b.name)).then(() => setBranches(null))}>
              <span>{b.remote ? <><Cloud size={12} /> </> : null}{b.name}</span>
              <span className="faint">{b.when}</span>
            </button>
          ))}
        </div>
      )}

      {s.merging && (
        <div className="scm-merge">
          {t("Merge in progress")}{s.conflicts.length ? ` · ${t("{n} conflict(s)", { n: s.conflicts.length })}` : ` · ${t("no conflicts: commit to finish it")}`}
          <button className="linkish" onClick={() => confirm(t("Abort the merge and go back to how it was?")) && act("abort", () => api.scmAbortMerge(tab.id))}>{t("abort")}</button>
        </div>
      )}

      <div className="scm-commit">
        <textarea
          className="field"
          rows={2}
          placeholder={t("Message (Ctrl+Enter to commit on {branch})", { branch: s.branch ?? "HEAD" })}
          aria-label={t("Commit message")}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canCommit) act("commit", () => api.scmCommit(tab.id, { message: msg, amend, all: nothingStaged && !amend })).then(() => setMsg(""));
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn sm primary" style={{ flex: 1, justifyContent: "center" }} disabled={!canCommit || !!busy} onClick={() => act("commit", () => api.scmCommit(tab.id, { message: msg, amend, all: nothingStaged && !amend })).then(() => setMsg(""))}>
            {busy === "commit" ? <span className="spin" /> : <Check size={14} />} {amend ? "Amend" : nothingStaged && dirty ? t("Commit (everything)") : "Commit"}
          </button>
          <label className="faint" style={{ fontSize: 11.5, display: "flex", gap: 4, alignItems: "center" }} title={t("Rewrites the last commit (don't if you already pushed it)")}>
            <input type="checkbox" checked={amend} disabled={!s.hasCommits} onChange={(e) => setAmend(e.target.checked)} /> amend
          </label>
        </div>
        {nothingStaged && dirty && !amend && <div className="faint" style={{ fontSize: 11 }}>{t("Nothing is staged: the commit includes every change.")}</div>}
      </div>
      {error && <div className="errline scm-err">{error}</div>}

      {s.conflicts.length > 0 && <Section title={t("Conflicts")} n={s.conflicts.length}>{s.conflicts.map((c) => row(c, "conflict"))}</Section>}
      {s.staged.length > 0 && (
        <Section title={t("Staged")} n={s.staged.length} action={<button title={t("Unstage everything")} aria-label={t("Unstage everything")} onClick={() => act("u", () => api.scmUnstage(tab.id, "all"))}><Minus size={14} /></button>}>
          {s.staged.map((c) => row(c, "staged"))}
        </Section>
      )}
      {s.unstaged.length + s.untracked.length > 0 && (
        <Section title={t("Changes")} n={s.unstaged.length + s.untracked.length} action={<button title={t("Stage everything")} aria-label={t("Stage everything")} onClick={() => act("s", () => api.scmStage(tab.id, "all"))}><Plus size={14} /></button>}>
          {s.unstaged.map((c) => row(c, "unstaged"))}
          {s.untracked.map((c) => row(c, "untracked"))}
        </Section>
      )}
      {!s.staged.length && !dirty && !s.conflicts.length && <div className="faint" style={{ padding: "8px 12px", fontSize: 12.5 }}>{t("No changes. Everything is committed.")}</div>}

      <Section title="Stash" n={s.stashes.length} action={<button title={t("Save the current changes in a stash (untracked included)")} aria-label={t("Save the current changes in a stash (untracked included)")} disabled={!dirty && nothingStaged} onClick={() => act("st", () => api.scmStash(tab.id, { op: "push", message: msg || undefined }))}><Plus size={14} /></button>} closed={!s.stashes.length}>
        {s.stashes.map((st) => (
          <div key={st.index} className="scm-row stash" title={st.message}>
            <span className="nm">{st.message}</span>
            <span className="scm-acts" style={{ display: "flex" }}>
              <button title={t("Apply and drop the stash (pop)")} onClick={() => act("st", () => api.scmStash(tab.id, { op: "pop", index: st.index }))}>pop</button>
              <button title={t("Apply without dropping")} onClick={() => act("st", () => api.scmStash(tab.id, { op: "apply", index: st.index }))}>apply</button>
              <button title={t("Drop the stash")} onClick={() => confirm(t("Drop this stash?")) && act("st", () => api.scmStash(tab.id, { op: "drop", index: st.index }))}><X size={12} /></button>
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, n, action, children, closed }: { title: string; n: number; action?: React.ReactNode; children: React.ReactNode; closed?: boolean }) {
  return (
    <details className="scm-sec" open={!closed}>
      <summary>
        <span className="caret"><ChevronRight size={14} /></span> {title} <span className="pill">{n}</span>
        <span className="scm-sec-act" onClick={(e) => e.preventDefault()}>{action}</span>
      </summary>
      {children}
    </details>
  );
}
