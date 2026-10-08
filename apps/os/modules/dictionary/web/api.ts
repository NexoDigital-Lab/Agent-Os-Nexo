import { call } from "@os/lib/http";
import type { Term, TermInput } from "../server/dictionary.ts";
export type { Term, TermInput };

const at = (term: string) => `/api/dictionary/${encodeURIComponent(term)}`;

export const dictionaryApi = {
  list: () => call<Term[]>("GET", "/api/dictionary"),
  show: (term: string) => call<Term>("GET", at(term)),
  create: (input: TermInput) => call<Term>("POST", "/api/dictionary", input),
  /** `current` is the term's name now; `input.term` may rename it. */
  update: (current: string, input: TermInput) => call<Term>("PUT", at(current), input),
  remove: (term: string) => call("DELETE", at(term)),
};
