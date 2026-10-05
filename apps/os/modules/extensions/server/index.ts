// extensions: the general list, each project's list and recommendations, VS Code installs.
import { h } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { installExtension } from "../../projects/server/vscode.ts";
import * as ext from "./extensions.ts";

const register: ModuleServer = (ctx) => {
  ext.initExtensions(ctx.env);
  const api = ctx.api;
  api.get("/extensions", h(() => ext.overview()));
  api.put("/extensions/general", h((req) => ext.saveGeneral(req.body.general)));
  api.post("/extensions/install", h((req) => installExtension(String(req.body.id ?? ""))));
  api.get("/projects/:id/extensions", h((req) => ext.projectExtensions(String(req.params.id))));
  api.put("/projects/:id/extensions", h((req) => ext.saveProjectExtensions(String(req.params.id), req.body)));
  api.post("/projects/:id/extensions/sync", h((req) => ext.syncVscode(String(req.params.id))));
  api.post("/projects/:id/extensions/recommend", h((req) => ext.recommendWithClaude(String(req.params.id))));
};

export default register;
