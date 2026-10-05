// editor/lsp: language servers per tab and language (WebSocket /api/tabs/:id/lsp/:lang), Go and Python.
import { h } from "../../../../../host/server/http.ts";
import type { ModuleServer } from "../../../../../host/server/module-api.ts";
import { onTabClose, tabCwd } from "../../../../sessions/server/agent.ts";
import { attachLsp, killTabLsp, lspStatus } from "./lsp.ts";

const register: ModuleServer = (ctx) => {
  attachLsp(ctx.server, ctx.port, tabCwd);
  onTabClose(killTabLsp);
  ctx.api.get("/lsp/:lang/status", h((req) => lspStatus(String(req.params.lang))));
};

export default register;
