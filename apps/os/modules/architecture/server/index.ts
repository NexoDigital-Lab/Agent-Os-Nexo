// architecture: the project's defined architecture (doc + proposed folder tree, in context/architecture/), the
// architect assistant (/api/architecture/:project/*), and the note that makes each tab's agent follow it (off per tab).
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import * as agent from "../../sessions/server/agent.ts";
import { contributeToSessions } from "../../sessions/server/contributions.ts";
import { tabOf } from "../../sessions/server/index.ts";
import * as advisor from "./advisor.ts";
import * as store from "./store.ts";

const register: ModuleServer = (ctx) => {
  // The architecture goes into the system prompt of every tab on the project, unless the tab turned it off.
  contributeToSessions({
    promptNote: (tab) => (tab.project && !tab.meta.archOff ? store.architecturePrompt(tab.project) : null),
  });

  const api = ctx.api;
  const proj = (req: { params: Record<string, unknown> }) => String(req.params.project);

  api.get("/architecture/:project", h((req) => store.readArch(proj(req))));
  api.put("/architecture/:project/doc", h((req) => (store.writeDoc(proj(req), req.body?.markdown), ok)));
  api.put("/architecture/:project/tree", h((req) => store.writeTree(proj(req), req.body?.tree)));
  api.post("/architecture/:project/import", h((req) => store.importTree(proj(req))));
  api.post("/architecture/:project/advise", h((req) => {
    const { mode, focus, lang } = req.body ?? {};
    if (mode !== "start" && mode !== "analyze") throw httpError(400, "Invalid mode");
    return advisor.advise(proj(req), mode, focus ? String(focus) : undefined, advisor.answerLanguage(lang));
  }));
  api.post("/architecture/:project/chat", h((req) => advisor.chat(proj(req), req.body?.message, advisor.answerLanguage(req.body?.lang))));
  api.delete("/architecture/:project/chat", h((req) => (store.dirOf(proj(req)), advisor.clearChat(proj(req)), ok)));

  // Turns the architecture on/off for a tab; takes effect on its next turn.
  api.post("/tabs/:id/architecture", h((req) => (agent.setTabMeta(tabOf(req).id, "archOff", !req.body?.on), ok)));
};

export default register;
