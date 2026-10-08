// dictionary: the user's concepts (/api/dictionary), stored in library/dictionary/ through `nexo dict`.
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import * as dictionary from "./dictionary.ts";

const register: ModuleServer = (ctx) => {
  const api = ctx.api;
  const term = (raw: unknown) => {
    const name = String(raw ?? "").trim();
    if (!name || name.length > 80) throw httpError(400, "Invalid term");
    return name;
  };
  api.get("/dictionary", h(() => dictionary.listTerms(ctx.env)));
  api.get("/dictionary/:term", h((req) => dictionary.showTerm(ctx.env, term(req.params.term))));
  api.post("/dictionary", h((req) => dictionary.saveTerm(ctx.env, dictionary.parseInput(req.body))));
  // Edit: the URL names the term as it is now; the body may give it a new name.
  api.put("/dictionary/:term", h((req) => dictionary.saveTerm(ctx.env, dictionary.parseInput(req.body), term(req.params.term))));
  api.delete("/dictionary/:term", h(async (req) => (await dictionary.removeTerm(ctx.env, term(req.params.term)), ok)));
};

export default register;
