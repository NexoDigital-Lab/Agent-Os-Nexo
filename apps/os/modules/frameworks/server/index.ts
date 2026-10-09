// frameworks: third-party agent frameworks (/api/frameworks), managed through `nexo framework`. A framework is set up
// here once for the whole environment, then chosen per chat tab (sessions) — like an AI provider.
import { h } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import * as frameworks from "./frameworks.ts";

const register: ModuleServer = (ctx) => {
  const api = ctx.api;
  api.get("/frameworks", h(() => frameworks.list(ctx.env)));
  api.post("/frameworks", h((req) => frameworks.add(ctx.env, req.body)));
  api.post("/frameworks/default", h((req) => frameworks.setDefault(ctx.env, req.body)));
  api.post("/frameworks/:name/enabled", h((req) => frameworks.setEnabled(ctx.env, frameworks.nameOf(req.params.name), req.body)));
  api.post("/frameworks/:name/hooks", h((req) => frameworks.setHooks(ctx.env, frameworks.nameOf(req.params.name), req.body)));
  api.delete("/frameworks/:name", h((req) => frameworks.remove(ctx.env, frameworks.nameOf(req.params.name))));
};

export default register;
