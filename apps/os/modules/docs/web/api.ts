import { call, seg } from "@os/lib/http";
import type { Doc, DocLanguage, DocMeta } from "../../../src/core/docs.ts";
export type { Doc, DocMeta } from "../../../src/core/docs.ts";

export interface DocHit {
  slug: string;
  title: string;
  count: number;
  snippet: string;
}

const q = (lang: string) => `lang=${encodeURIComponent(lang)}`;

export const docsApi = {
  list: (lang: string) => call<{ lang: DocLanguage; docs: DocMeta[] }>("GET", `/api/docs?${q(lang)}`),
  get: (slug: string, lang: string) => call<Doc>("GET", `/api/docs/${seg(slug)}?${q(lang)}`),
  search: (text: string, lang: string) => call<{ hits: DocHit[] }>("GET", `/api/docs/search?q=${encodeURIComponent(text)}&${q(lang)}`),
};
