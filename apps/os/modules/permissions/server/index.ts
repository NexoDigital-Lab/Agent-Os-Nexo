// permissions: what agents may do alone (/api/permissions), edited through `nexo permissions`.
import { h } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import * as permissions from "./permissions.ts";

const register: ModuleServer = (ctx) => {
  const api = ctx.api;
  api.get("/permissions", h((req) => permissions.view(ctx.env, permissions.scopeOf(req.query.project))));
  api.post("/permissions/rule", h((req) => permissions.setRule(ctx.env, permissions.scopeOf(req.body?.project), req.body)));
  api.post("/permissions/setting", h((req) => permissions.setSetting(ctx.env, permissions.scopeOf(req.body?.project), req.body)));
};

export default register;
