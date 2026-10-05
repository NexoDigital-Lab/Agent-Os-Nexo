// editor/practice: the AI plans and reviews (read-only), the user writes the code (/api/tabs/:id/practice).
import { h } from "../../../../../host/server/http.ts";
import type { ModuleServer } from "../../../../../host/server/module-api.ts";
import { onTabClose } from "../../../../sessions/server/agent.ts";
import { tabOf } from "../../../../sessions/server/index.ts";
import { dropPractice, initPractice, makePlan, readPractice, snippet, validate } from "./practice.ts";

const register: ModuleServer = (ctx) => {
  initPractice(ctx.dataDir);
  onTabClose(dropPractice);
  const api = ctx.api;
  api.get("/tabs/:id/practice", h((req) => readPractice(tabOf(req).id)));
  api.post("/tabs/:id/practice/plan", h((req) => {
    const { id, cwd, dir } = tabOf(req);
    return makePlan(id, cwd, dir, String(req.body.task ?? ""));
  }));
  api.post("/tabs/:id/practice/snippet", h((req) => {
    const { id, cwd } = tabOf(req);
    return snippet(id, cwd, String(req.body.stepId));
  }));
  api.post("/tabs/:id/practice/validate", h((req) => {
    const { id, cwd } = tabOf(req);
    return validate(id, cwd);
  }));
};

export default register;
