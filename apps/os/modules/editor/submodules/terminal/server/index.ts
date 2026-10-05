// editor/terminal: real shells per tab (/api/tabs/:id/terms, WebSocket /api/tabs/:id/term/:tid).
import { h, ok } from "../../../../../host/server/http.ts";
import type { ModuleServer } from "../../../../../host/server/module-api.ts";
import { onTabClose } from "../../../../sessions/server/agent.ts";
import { tabOf } from "../../../../sessions/server/index.ts";
import { attachTerminal, createTerm, killTabTerms, killTerm, listTerms, shellFor, writeTerm } from "./terminal.ts";

const register: ModuleServer = (ctx) => {
  attachTerminal(ctx.server, ctx.port);
  onTabClose(killTabTerms);
  const api = ctx.api;
  api.get("/tabs/:id/terms", h((req) => listTerms(tabOf(req).id)));
  api.post("/tabs/:id/terms", h((req) => {
    const { id, cwd, project } = tabOf(req);
    const run = req.body?.run ? String(req.body.run) : undefined;
    const where = req.body?.where === "container" ? "container" : "host";
    const title = String(req.body?.title || (run ? `▶ ${run}` : where === "container" ? "container" : "bash")).slice(0, 60);
    return createTerm(id, cwd, title, run, shellFor(project, where));
  }));
  api.delete("/tabs/:id/terms/:tid", h((req) => (killTerm(tabOf(req).id, String(req.params.tid)), ok)));
  api.post("/tabs/:id/terms/:tid/input", h((req) => (writeTerm(tabOf(req).id, String(req.params.tid), String(req.body?.data ?? "")), ok)));
};

export default register;
