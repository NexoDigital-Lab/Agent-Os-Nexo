// nexo dict: the user's dictionary (core/dictionary.ts). Agents save a concept here when the user defines one, and
// read it before asking what a word means. Every change rebuilds library/index.json, where agents see the terms.
import { folder, readConfig } from "../core/config.ts";
import { findTerm, listTerms, removeTerm, saveTerm } from "../core/dictionary.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { findRoot } from "../core/paths.ts";

export interface DictOptions {
  root?: string;
  summary?: string;
  alias?: string;
  body?: string;
  /** add: rename this term to <term>. */
  from?: string;
  json?: boolean;
}

const USAGE = "Usage: nexo dict [list] | add <term> --summary <s> [--alias a,b] [--body <text>] [--from <old name>] | show <term> | rm <term>";

export function dict(action: string | undefined, words: string[], opts: DictOptions): string {
  const root = findRoot(opts.root);
  const library = folder(root, readConfig(root), "library");
  const name = words.join(" ").trim();
  switch (action ?? "list") {
    case "list": {
      const terms = listTerms(library);
      if (opts.json) return JSON.stringify(terms.map(({ body: _body, ...t }) => t), null, 2);
      if (!terms.length) return "The dictionary is empty. Add a term: nexo dict add <term> --summary <s>";
      return terms.map((t) => `${t.term}${t.aliases.length ? ` (${t.aliases.join(", ")})` : ""} — ${t.summary}`).join("\n");
    }
    case "add": {
      if (!name) throw new Error(USAGE);
      const aliases = opts.alias ? opts.alias.split(",") : [];
      const saved = saveTerm(library, { term: name, summary: opts.summary, aliases, body: opts.body, from: opts.from });
      buildLibraryIndex(library);
      return `${saved.created ? "Added" : "Updated"} "${saved.term}" in library/${saved.path.replace(/\\/g, "/")}.`;
    }
    case "show": {
      if (!name) throw new Error(USAGE);
      const t = findTerm(library, name);
      if (!t) throw new Error(`No term "${name}" in library/dictionary/.`);
      if (opts.json) return JSON.stringify(t, null, 2);
      return [`${t.term}${t.aliases.length ? ` (${t.aliases.join(", ")})` : ""}`, t.summary, ...(t.body ? ["", t.body] : [])].join("\n");
    }
    case "rm": {
      if (!name) throw new Error(USAGE);
      const gone = removeTerm(library, name);
      buildLibraryIndex(library);
      return `Removed "${gone.term}".`;
    }
    default:
      throw new Error(USAGE);
  }
}
