// docs: serves the agent-os documentation (docs/<lang>/*.md, shipped with every build) to the Docs view: the index
// of a language, one document, and a full-text search. A language without a document falls back to English.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { h, httpError } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { isDocLanguage, listDocs, readDoc, type DocLanguage } from "../../../src/core/docs.ts";

/** docs/ next to modules/: the same place in the source and in a build. */
const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs");
const MAX_QUERY = 100;
const MAX_HITS = 30;

const langOf = (v: unknown): DocLanguage => (isDocLanguage(v) ? v : "en");

/** A short piece of `body` around the first match, without markdown noise. */
function snippet(body: string, at: number, length: number): string {
  const start = Math.max(0, at - 60);
  const text = body.slice(start, at + length + 90).replace(/[#*`|>[\]]/g, "").replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}…`;
}

const register: ModuleServer = (ctx) => {
  const docsDir = process.env.NEXO_DOCS_DIR ?? DOCS_DIR; // tests point it at a fixture
  const api = ctx.api;

  api.get("/docs", h((req) => {
    const lang = langOf(req.query.lang);
    const docs = listDocs(docsDir, lang);
    return { lang: docs.length ? lang : "en", docs: docs.length ? docs : listDocs(docsDir, "en") };
  }));

  api.get("/docs/search", h((req) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return { hits: [] };
    if (q.length > MAX_QUERY) throw httpError(400, `The search is longer than ${MAX_QUERY} characters`);
    const lang = langOf(req.query.lang);
    const needle = q.toLowerCase();
    const hits = [];
    for (const meta of listDocs(docsDir, lang)) {
      const doc = readDoc(docsDir, lang, meta.slug)!;
      const inTitle = doc.title.toLowerCase().includes(needle) || doc.summary.toLowerCase().includes(needle);
      const at = doc.body.toLowerCase().indexOf(needle);
      if (!inTitle && at < 0) continue;
      const count = doc.body.toLowerCase().split(needle).length - 1;
      hits.push({ slug: doc.slug, title: doc.title, count, snippet: at >= 0 ? snippet(doc.body, at, q.length) : doc.summary, rank: (inTitle ? 1000 : 0) + count });
    }
    hits.sort((a, b) => b.rank - a.rank);
    return { hits: hits.slice(0, MAX_HITS).map(({ rank: _rank, ...hit }) => hit) };
  }));

  api.get("/docs/:slug", h((req) => {
    const slug = String(req.params.slug);
    const doc = readDoc(docsDir, langOf(req.query.lang), slug) ?? readDoc(docsDir, "en", slug);
    if (!doc) throw httpError(404, `Unknown document: ${slug}`);
    return doc;
  }));
};

export default register;
