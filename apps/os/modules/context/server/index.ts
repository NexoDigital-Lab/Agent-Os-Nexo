// context: a project's AGENTS.md and context/ (/api/projects/:id/context…), and a note for its agents.
import { h, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { openInEditor } from "../../projects/server/vscode.ts";
import { contributeToSessions } from "../../sessions/server/contributions.ts";
import * as context from "./context.ts";

const register: ModuleServer = (ctx) => {
  const api = ctx.api;
  const id = (raw: unknown) => String(raw ?? "");
  api.get("/projects/:id/context", h((req) => context.listContext(id(req.params.id))));
  api.get("/projects/:id/context/file", h((req) => context.readDoc(id(req.params.id), req.query.path)));
  api.put("/projects/:id/context/file", h((req) => context.writeDoc(id(req.params.id), req.body)));
  // VS Code: one document (from the project folder, so AGENTS.md works too), or the whole context/ folder.
  api.post("/projects/:id/context/open", h((req) => {
    const dir = context.dirOf(id(req.params.id));
    openInEditor(dir, context.contextPath(req.body?.path === undefined ? "context" : String(req.body.path), true));
    return ok;
  }));

  contributeToSessions({ promptNote: (tab) => (tab.project ? context.promptNote(tab.project) : null) });
};

export default register;
