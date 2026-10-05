// notes: the notepad (/api/notes), AI proposals and drafts for projects that don't exist yet (/api/notes/drafts).
import { h, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import * as notes from "./notes.ts";

const register: ModuleServer = (ctx) => {
  notes.initNotes(ctx.dataDir);
  const api = ctx.api;
  api.get("/notes", h(() => notes.listNotes()));
  api.post("/notes", h((req) => notes.saveNote(req.body)));
  api.put("/notes/:id", h((req) => notes.saveNote({ ...req.body, id: String(req.params.id) })));
  api.delete("/notes/:id", h((req) => (notes.deleteNote(String(req.params.id)), ok)));
  api.post("/notes/analyze", h((req) => notes.analyze((req.body.ids ?? []).map(String))));
  api.post("/notes/accept", h((req) => notes.acceptProposals(String(req.body.project), req.body.proposals ?? [])));
  api.get("/notes/drafts", h(() => notes.listDrafts()));
  api.post("/notes/drafts/promote", h((req) => ({ features: notes.promoteDrafts(String(req.body.project)) })));
  api.delete("/notes/drafts/:id", h((req) => (notes.deleteDraft(String(req.params.id)), ok)));
};

export default register;
