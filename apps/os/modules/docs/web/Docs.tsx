// The Docs view: the index of the documentation in the app's language, a full-text search, and a reader. Links
// between documents open here; links to source files are shown as code paths (they live in the repository).
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { BookOpen, Search, X } from "lucide-react";
import { language, t } from "@os/i18n";
import { renderMarkdown } from "@os/lib/markdown";
import { readStr, writeStr } from "@os/lib/storage";
import { docsApi, type Doc, type DocHit, type DocMeta } from "./api";

const LAST = "docs.last";

export function Docs() {
  const lang = language();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DocHit[] | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(""); // the document asked last: a slow answer for an earlier one must not replace it
  const reader = useRef<HTMLDivElement>(null);

  const open = (slug: string) => {
    latest.current = slug;
    setError("");
    docsApi.get(slug, lang).then(
      (d) => {
        if (latest.current !== slug) return;
        setDoc(d);
        writeStr(LAST, slug);
        reader.current?.scrollTo({ top: 0 });
      },
      (e) => latest.current === slug && setError(e.message),
    );
  };

  useEffect(() => {
    docsApi.list(lang).then(
      (r) => {
        setDocs(r.docs);
        const last = readStr(LAST);
        const first = r.docs.find((d) => d.slug === last) ?? r.docs[0];
        if (first) open(first.slug);
      },
      (e) => setError(e.message),
    );
  }, [lang]);

  // Search as you type, a moment after the last key; an older answer never replaces a newer one.
  useEffect(() => {
    const text = query.trim();
    if (!text) return setHits(null);
    let live = true;
    const timer = setTimeout(() => docsApi.search(text, lang).then((r) => live && setHits(r.hits), (e) => live && setError(e.message)), 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, lang]);

  const html = useMemo(() => (doc ? renderMarkdown(doc.body) : ""), [doc]);

  function onLink(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href) return;
    if (/^https?:/.test(href)) {
      a.target = "_blank";
      a.rel = "noreferrer";
      return;
    }
    e.preventDefault();
    const other = /^([a-z0-9-]+)\.md(#.*)?$/.exec(href);
    if (other) open(other[1]!);
  }

  return (
    <div className="page docs-page">
      <div className="docs-head">
        <h1><BookOpen size={20} /> {t("Documentation")}</h1>
        <p className="sub">{t("How agent-os-nexo works, how to write and review modules, and how to install and run it.")}</p>
      </div>
      {error && <p className="errline" role="alert">{t(error)}</p>}
      <div className="docs-cols">
        <nav className="card docs-index" aria-label={t("Documents")}>
          <label className="docs-search">
            <Search size={14} aria-hidden="true" />
            <input className="field" value={query} placeholder={t("Search the docs")} aria-label={t("Search the docs")} onChange={(e) => setQuery(e.target.value)} />
            {query && <button className="btn sm ghost" aria-label={t("Clear the search")} title={t("Clear the search")} onClick={() => setQuery("")}><X size={14} /></button>}
          </label>
          {docs === null && !error ? (
            <div className="empty"><span className="spin" /></div>
          ) : hits ? (
            hits.length === 0 ? (
              <p className="empty">{t("Nothing matches “{q}”.", { q: query.trim() })}</p>
            ) : (
              <ul className="docs-list">
                {hits.map((h) => (
                  <li key={h.slug}>
                    <button className={doc?.slug === h.slug ? "on" : ""} onClick={() => open(h.slug)}>
                      <b>{h.title}</b>
                      <span className="faint">{h.snippet}</span>
                      {h.count > 0 && <span className="pill">{h.count === 1 ? t("1 match") : t("{n} matches", { n: h.count })}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : docs?.length === 0 ? (
            <p className="empty">{t("No documentation in this build.")}</p>
          ) : (
            <ul className="docs-list">
              {docs?.map((d) => (
                <li key={d.slug}>
                  <button className={doc?.slug === d.slug ? "on" : ""} aria-current={doc?.slug === d.slug ? "page" : undefined} onClick={() => open(d.slug)}>
                    <b>{d.title}</b>
                    <span className="faint">{d.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <article className="card docs-reader" ref={reader} aria-live="polite">
          {doc ? (
            <>
              {doc.lang !== lang && <p className="docs-fallback faint">{t("Not translated yet: shown in English.")}</p>}
              <div className="md" onClick={onLink} dangerouslySetInnerHTML={{ __html: html }} />
            </>
          ) : (
            !error && <div className="empty"><span className="spin" /></div>
          )}
        </article>
      </div>
    </div>
  );
}
