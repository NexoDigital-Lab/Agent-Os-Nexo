// editor/setup: the project setup assistant (/api/tabs/:id/setup): toolchains, dependencies, .env, extensions.
import { h } from "../../../../../host/server/http.ts";
import type { ModuleServer } from "../../../../../host/server/module-api.ts";
import { tabOf } from "../../../../sessions/server/index.ts";
import * as setup from "./setup.ts";

const register: ModuleServer = (ctx) => {
  const api = ctx.api;
  api.get("/tabs/:id/setup", h((req) => {
    const { project, cwd } = tabOf(req);
    return setup.analyze(project, cwd);
  }));
  api.post("/tabs/:id/setup/plan", h((req) => {
    const { project, cwd } = tabOf(req);
    return setup.planSetup(project, cwd, req.body ?? {});
  }));
  api.post("/tabs/:id/setup/apply", h((req) => {
    const { project, cwd } = tabOf(req);
    return setup.applySetup(project, cwd, req.body ?? {});
  }));
};

export default register;
