// visual-bugs: paste a screenshot, add a note, and an agent reads the folder when fixing visual bugs.
import express from "express";
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import * as bugs from "./bugs.ts";

const register: ModuleServer = (ctx) => {
  bugs.initBugs(ctx.dataDir);
  const api = ctx.api;

  api.get("/visual-bugs", h(() => bugs.listBugs()));
  api.post(
    "/visual-bugs",
    express.raw({ type: Object.keys(bugs.IMAGE_TYPES), limit: "12mb" }),
    h((req) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(415, "Empty image or unsupported format");
      return bugs.saveBug(req.body, String(req.headers["content-type"]).split(";")[0]!.trim().toLowerCase());
    }),
  );
  api.get("/visual-bugs/:name", (req, res) => {
    const file = bugs.bugPath(String(req.params.name));
    if (!file) return void res.status(404).end();
    // User-pasted bytes: never let the browser sniff them into something executable, and don't cache stale deletes.
    res.set({ "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    res.sendFile(file);
  });
  api.patch(
    "/visual-bugs/:name",
    h((req) => {
      const note = req.body?.note;
      if (typeof note !== "string") throw httpError(400, "The note must be text");
      bugs.setNote(String(req.params.name), note.trim().slice(0, 2000));
      return ok;
    }),
  );
  api.delete("/visual-bugs/:name", h((req) => (bugs.deleteBug(String(req.params.name)), ok)));
};

export default register;
