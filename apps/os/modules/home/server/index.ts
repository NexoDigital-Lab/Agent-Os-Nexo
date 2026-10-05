// home: goals, inbox and today's log (/api/home/*); every agent-os turn is logged here.
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { contributeToSessions } from "../../sessions/server/contributions.ts";
import { addToInbox, initData, logSession, readDoc, todayCost, writeDoc, type Doc } from "./data.ts";

const DOCS: Doc[] = ["inbox", "goals", "log"];

const register: ModuleServer = (ctx) => {
  initData({ data: ctx.dataDir, state: ctx.stateDir });
  contributeToSessions({ onTurnEnd: (tab, info) => logSession({ project: tab.project, ...info }) });

  ctx.api.get("/home/:doc", h((req) => {
    const doc = String(req.params.doc) as Doc;
    if (!DOCS.includes(doc)) throw httpError(404, "Unknown document");
    return { text: readDoc(doc), todayCost: todayCost() };
  }));
  ctx.api.put("/home/:doc", h((req) => {
    const doc = String(req.params.doc);
    if (doc !== "inbox" && doc !== "goals") throw httpError(400, "Only inbox or goals can be edited");
    writeDoc(doc, String(req.body.text ?? ""));
    return ok;
  }));
  ctx.api.post("/home/inbox", h((req) => (addToInbox(String(req.body.text ?? ""), req.body.project ?? null), ok)));
};

export default register;
