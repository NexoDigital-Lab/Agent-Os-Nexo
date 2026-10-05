import { ChevronDown, ChevronRight, ReplaceAll } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon } from "./icons";
import { editorApi as api, type SearchHit, type Tab } from "./api";
import { toggled } from "@os/lib/ui";
import { t } from "@os/i18n";
import { ConfirmButton } from "@os/lib/ConfirmButton";

/** Buscar en todo el proyecto (Ctrl+Shift+F), with replace in the files you leave ticked. */
export function Search({ tab, onOpen, onReplaced, focusKey }: { tab: Tab; onOpen: (path: string, line: number, col: number) => void; onReplaced: (paths: string[]) => void; focusKey: number }) {
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("");
  const [showRep, setShowRep] = useState(false);
  const [opts, setOpts] = useState({ regex: false, matchCase: false, word: false });
  const [res, setRes] = useState<{ hits: SearchHit[]; truncated: boolean } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set()); // files unticked for replace
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    if (!q) return setRes(null);
    const t = setTimeout(() => {
      setError("");
      api.search(tab.id, { q, ...opts }).then((r) => (setRes(r), setSkip(new Set())), (e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, opts.regex, opts.matchCase, opts.word]);

  const byFile = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of res?.hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m];
  }, [res]);

  const ticked = { files: byFile.filter(([f]) => !skip.has(f)).length, n: byFile.filter(([f]) => !skip.has(f)).reduce((k, [, hs]) => k + hs.length, 0) };

  async function replaceAll() {
    const files = byFile.map(([f]) => f).filter((f) => !skip.has(f));
    if (!files.length) return;
    setBusy(true);
    try {
      const r = await api.replace(tab.id, { q, ...opts, replacement: rep, files });
      onReplaced(r.changed.map((c) => c.path));
      setRes(await api.search(tab.id, { q, ...opts }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const tog = (k: keyof typeof opts, label: string, title: string) => (
    <button className={`opt ${opts[k] ? "on" : ""}`} title={title} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}>{label}</button>
  );

  return (
    <div className="search">
      <div className="search-row">
        <button className="linkish" title={t("Show replace")} aria-label={t("Show replace")} onClick={() => setShowRep(!showRep)}>{showRep ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <input ref={input} className="field mono" placeholder={t("Search the project")} aria-label={t("Search the project")} value={q} onChange={(e) => setQ(e.target.value)} />
        {tog("matchCase", "Aa", t("Match case"))}
        {tog("word", "ab", t("Whole word"))}
        {tog("regex", ".*", t("Regular expression"))}
      </div>
      {showRep && (
        <div className="search-row" style={{ paddingLeft: 22 }}>
          <input className="field mono" placeholder={t("Replace with")} aria-label={t("Replace with")} value={rep} onChange={(e) => setRep(e.target.value)} />
          <ConfirmButton className="btn sm" disabled={!res?.hits.length || busy} title={t("Replace in the ticked files")} confirmText={t("Replace {n} match(es) in {files} file(s)? It writes to disk (you can revert it from Changes).", { n: ticked.n, files: ticked.files })} onConfirm={replaceAll}>{busy ? <span className="spin" /> : <ReplaceAll size={14} />} {t("All")}</ConfirmButton>
        </div>
      )}
      {error && <div className="errline" style={{ padding: "0 10px" }}>{error}</div>}
      {res && (
        <div className="faint" style={{ padding: "2px 10px 6px", fontSize: 11.5 }}>
          {t("{n} result(s) in {files} file(s)", { n: res.hits.length, files: byFile.length })}{res.truncated ? ` — ${t("showing the first 2000")}` : ""}
        </div>
      )}
      <div className="search-res">
        {byFile.map(([file, hits]) => (
          <details key={file} open>
            <summary className="search-file">
              {showRep && <input type="checkbox" checked={!skip.has(file)} onClick={(e) => e.stopPropagation()} onChange={() => setSkip((s) => toggled(s, file))} />}
              <FileIcon name={file.split("/").pop()!} />
              <span className="nm">{file.split("/").pop()}</span>
              <span className="faint dir">{file.split("/").slice(0, -1).join("/")}</span>
              <span className="pill">{hits.length}</span>
            </summary>
            {hits.map((h, i) => (
              <div key={i} className="search-hit" onClick={() => onOpen(h.path, h.line, h.col)} title={`${h.path}:${h.line}`}>
                <span className="faint mono ln">{h.line}</span>
                <Highlight text={h.text} col={h.col} len={opts.regex ? 0 : q.length} />
              </div>
            ))}
          </details>
        ))}
      </div>
    </div>
  );
}

function Highlight({ text, col, len }: { text: string; col: number; len: number }) {
  const t = text.replace(/\t/g, "  ");
  const start = Math.max(0, col - 1);
  const from = Math.max(0, start - 30); // keep the match in view on long lines
  if (!len) return <span className="mono txt">{(from ? "…" : "") + t.slice(from).trim()}</span>;
  return (
    <span className="mono txt">
      {from ? "…" : ""}{t.slice(from, start)}<mark>{t.slice(start, start + len)}</mark>{t.slice(start + len)}
    </span>
  );
}
