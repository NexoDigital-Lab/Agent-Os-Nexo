// The Docs view, opened from the bottom of Settings (it has no rail button): a cover with every document by group,
// and a reader with the index on the left, the document's outline on the right, and the previous / next document
// below. Search runs as you type ("/" focuses it). Links between documents open here; #links scroll the reader.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Clock, Compass, Puzzle, Search, Settings, Shapes, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { language, t } from "@os/i18n";
import { renderMarkdown } from "@os/lib/markdown";
import { readStr, writeStr } from "@os/lib/storage";
import { goTo } from "../../shell/web/nav";
import { docsApi, type Doc, type DocHit, type DocMeta } from "./api";
import { enhance, readingMinutes } from "./enhance";

const LAST = "docs.last";

const GROUPS: { id: DocMeta["group"]; label: string; about: string; icon: LucideIcon }[] = [
  { id: "start", label: "Get started", about: "Use the app and understand how it is put together.", icon: Compass },
  { id: "build", label: "Build modules", about: "Add a module, follow the rules, review a change.", icon: Puzzle },
  { id: "reference", label: "Reference", about: "Every module, and the security model.", icon: Shapes },
];

/** `text` with every case-insensitive `needle` marked. */
function marked(text: string, needle: string): ReactNode[] {
  if (!needle) return [text];
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

export function Docs() {
  const lang = language();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DocHit[] | null>(null);
  const [error, setError] = useState("");
  const [here, setHere] = useState("");
  const latest = useRef(""); // the document asked last: a slow answer for an earlier one must not replace it
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const open = (slug: string, anchor?: string) => {
    latest.current = slug;
    setError("");
    docsApi.get(slug, lang).then(
      (d) => {
        if (latest.current !== slug) return;
        setDoc(d);
        setQuery("");
        writeStr(LAST, slug);
        requestAnimationFrame(() => (anchor ? jump(anchor) : scroller.current?.scrollTo({ top: 0 })));
      },
      (e) => latest.current === slug && setError(e.message),
    );
  };

  const cover = () => {
    latest.current = "";
    setDoc(null);
    setQuery("");
    writeStr(LAST, "");
    scroller.current?.scrollTo({ top: 0 });
  };

  /** Where `el` sits inside the scrolling reader (offsetTop counts from the page, bars and banners included). */
  const topIn = (box: HTMLElement, el: HTMLElement) => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;

  const jump = (id: string) => {
    const box = scroller.current;
    const target = box?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (box && target) box.scrollTo({ top: topIn(box, target) - 16, behavior: "smooth" });
  };

  useEffect(() => {
    docsApi.list(lang).then(
      (r) => {
        setDocs(r.docs);
        const last = readStr(LAST);
        if (last && r.docs.some((d) => d.slug === last)) open(last);
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

  // "/" anywhere but a text field jumps to the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || el.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const view = useMemo(() => (doc ? enhance(renderMarkdown(doc.body), t("Copy")) : null), [doc]);

  // The outline follows the reading: the last heading above the top of the reader is "here". The headings are looked
  // up once per document and positions read at most once a frame, however fast the scroll events come.
  useEffect(() => {
    const box = scroller.current;
    if (!box || !view?.outline.length) return setHere("");
    const heads = view.outline.flatMap((o) => {
      const el = box.querySelector<HTMLElement>(`#${CSS.escape(o.id)}`);
      return el ? [{ id: o.id, el }] : [];
    });
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = box.getBoundingClientRect().top;
      let current = view.outline[0]!.id;
      for (const h of heads) if (h.el.getBoundingClientRect().top - top <= 96) current = h.id;
      setHere(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [view]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    const copy = el.closest<HTMLButtonElement>("button.docs-copy");
    if (copy) {
      const pre = copy.closest(".docs-code")?.querySelector("pre");
      // No clipboard (no permission, or not a secure page): select the code so Ctrl+C copies it.
      const select = () => pre && getSelection()?.selectAllChildren(pre);
      if (!navigator.clipboard) return select();
      navigator.clipboard.writeText(pre?.textContent ?? "").then(() => {
        copy.textContent = t("Copied");
        setTimeout(() => (copy.textContent = t("Copy")), 1500);
      }, select);
      return;
    }
    const a = el.closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href || /^(https?|mailto):/.test(href)) return; // outside links open in a new window
    e.preventDefault();
    if (href.startsWith("#")) return jump(href.slice(1));
    const other = /^([a-z0-9-]+)\.md(?:#(.*))?$/.exec(href);
    if (other) open(other[1]!, other[2]);
  }

  const index = docs ?? [];
  // Previous / next walk the docs in the order the sidebar shows them: group by group.
  const reading = GROUPS.flatMap((g) => index.filter((d) => d.group === g.id));
  const at = doc ? reading.findIndex((d) => d.slug === doc.slug) : -1;
  const prev = at > 0 ? reading[at - 1] : undefined;
  const next = at >= 0 ? reading[at + 1] : undefined;
  const groupOf = (id: DocMeta["group"]) => GROUPS.find((g) => g.id === id) ?? GROUPS[2]!;
  const needle = query.trim();

  return (
    <div className="docs-page">
      <header className="docs-bar">
        <button className="btn sm ghost" onClick={() => goTo("settings")} title={t("Back to Settings")}>
          <ArrowLeft size={14} /> <Settings size={14} aria-hidden="true" /> {t("Settings")}
        </button>
        <button className="docs-brand" onClick={cover}>
          <BookOpen size={16} aria-hidden="true" /> {t("Documentation")}
        </button>
        <label className="docs-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={search}
            value={query}
            placeholder={t("Search the docs")}
            aria-label={t("Search the docs")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
          {query ? (
            <button className="docs-clear" aria-label={t("Clear the search")} title={t("Clear the search")} onClick={() => setQuery("")}><X size={13} /></button>
          ) : (
            <kbd aria-hidden="true">/</kbd>
          )}
        </label>
      </header>
      {error && <p className="errline docs-error" role="alert">{t(error)}</p>}

      <div className="docs-body">
        <nav className="docs-index" aria-label={t("Documents")}>
          {docs === null && !error ? (
            <div className="empty"><span className="spin" /></div>
          ) : docs?.length === 0 ? (
            <p className="empty">{t("No documentation in this build.")}</p>
          ) : (
            GROUPS.map((g) => {
              const items = index.filter((d) => d.group === g.id);
              return items.length ? (
                <section key={g.id}>
                  <h2>{t(g.label)}</h2>
                  <ul>
                    {items.map((d) => (
                      <li key={d.slug}>
                        <button className={doc?.slug === d.slug ? "on" : ""} aria-current={doc?.slug === d.slug ? "page" : undefined} onClick={() => open(d.slug)}>
                          {d.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null;
            })
          )}
        </nav>

        <div className="docs-scroll" ref={scroller} onClick={onClick}>
          {hits ? (
            <section className="docs-results" aria-live="polite">
              <p className="docs-eyebrow">{t("Search")}</p>
              <h1>{hits.length ? t("Results for “{q}”", { q: needle }) : t("Nothing matches “{q}”.", { q: needle })}</h1>
              <ul>
                {hits.map((h) => (
                  <li key={h.slug}>
                    <button onClick={() => open(h.slug)}>
                      <span className="docs-result-head">
                        <b>{marked(h.title, needle)}</b>
                        {h.count > 0 && <span className="pill">{h.count === 1 ? t("1 match") : t("{n} matches", { n: h.count })}</span>}
                      </span>
                      <span className="docs-snippet">{marked(h.snippet, needle)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : doc && view ? (
            <div className="docs-reading">
              <article className="docs-article">
                <header className="docs-head">
                  <p className="docs-eyebrow">{t(groupOf(doc.group).label)}</p>
                  <h1>{doc.title}</h1>
                  <p className="docs-lede">{doc.summary}</p>
                  <p className="docs-meta">
                    <span><Clock size={13} aria-hidden="true" /> {t("{n} min read", { n: readingMinutes(doc.body) })}</span>
                    {doc.lang !== lang && <span className="pill">{t("Not translated yet: shown in English.")}</span>}
                  </p>
                </header>
                <div className="md docs-md" dangerouslySetInnerHTML={{ __html: view.html }} />
                <footer className="docs-pager">
                  {prev ? (
                    <button onClick={() => open(prev.slug)}>
                      <span><ArrowLeft size={13} /> {t("Previous")}</span>
                      <b>{prev.title}</b>
                    </button>
                  ) : <span />}
                  {next && (
                    <button className="next" onClick={() => open(next.slug)}>
                      <span>{t("Next")} <ArrowRight size={13} /></span>
                      <b>{next.title}</b>
                    </button>
                  )}
                </footer>
              </article>
              {view.outline.length > 1 && (
                <aside className="docs-outline" aria-label={t("On this page")}>
                  <p>{t("On this page")}</p>
                  <ul>
                    {view.outline.map((o) => (
                      <li key={o.id} className={`l${o.level}${here === o.id ? " on" : ""}`}>
                        <a href={`#${o.id}`}>{o.text}</a>
                      </li>
                    ))}
                  </ul>
                </aside>
              )}
            </div>
          ) : docs?.length ? (
            <section className="docs-cover">
              <p className="docs-eyebrow">agent-os-nexo</p>
              <h1>{t("Documentation")}</h1>
              <p className="docs-lede">{t("How to use agent-os-nexo, how it works inside, and how to build and review modules for it.")}</p>
              {GROUPS.map((g) => {
                const items = index.filter((d) => d.group === g.id);
                const I = g.icon;
                return items.length ? (
                  <div key={g.id} className="docs-group">
                    <div className="docs-group-head">
                      <span className="docs-group-icon"><I size={16} aria-hidden="true" /></span>
                      <div>
                        <h2>{t(g.label)}</h2>
                        <p>{t(g.about)}</p>
                      </div>
                    </div>
                    <div className="docs-cards">
                      {items.map((d) => (
                        <button key={d.slug} className="docs-card" onClick={() => open(d.slug)}>
                          <b>{d.title}</b>
                          <span>{d.summary}</span>
                          <ArrowRight size={14} className="go" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null;
              })}
            </section>
          ) : (
            !error && docs === null && <div className="empty"><span className="spin" /></div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The last block of Settings: where the documentation is opened from. */
export function DocsSettings() {
  return (
    <div className="docs-settings">
      <p className="faint">{t("How to use agent-os-nexo, how it works inside, and how to build and review modules for it.")}</p>
      <button className="btn" onClick={() => goTo("docs")}>
        <BookOpen size={14} /> {t("Open the documentation")}
      </button>
    </div>
  );
}
