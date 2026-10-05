// editor/scm: source control of a tab (stage, commit, sync, branches, stash, conflicts), the commit graph and diffs.
import { h, httpError } from "../../../../../host/server/http.ts";
import type { ModuleServer } from "../../../../../host/server/module-api.ts";
import { tabOf } from "../../../../sessions/server/index.ts";
import { commitDetail, commitFileDiff, graph } from "./gitgraph.ts";
import * as scm from "./scm.ts";

const register: ModuleServer = (ctx) => {
  const git = ctx.api;
  git.get("/tabs/:id/scm", h((req) => scm.status(tabOf(req).cwd)));
  git.post("/tabs/:id/scm/stage", h((req) => scm.stage(tabOf(req).cwd, req.body?.paths)));
  git.post("/tabs/:id/scm/unstage", h((req) => scm.unstage(tabOf(req).cwd, req.body?.paths)));
  git.post("/tabs/:id/scm/discard", h((req) => scm.discard(tabOf(req).cwd, req.body?.paths)));
  git.post("/tabs/:id/scm/commit", h((req) => scm.commit(tabOf(req).cwd, req.body ?? {})));
  git.post("/tabs/:id/scm/sync/:op", h((req) => {
    const op = String(req.params.op);
    if (op !== "push" && op !== "pull" && op !== "fetch") throw httpError(400, "Unknown operation");
    return scm.sync(tabOf(req).cwd, op);
  }));
  git.get("/tabs/:id/scm/branches", h((req) => scm.branches(tabOf(req).cwd)));
  git.post("/tabs/:id/scm/checkout", h((req) => scm.checkout(tabOf(req).cwd, req.body ?? {})));
  git.post("/tabs/:id/scm/stash", h((req) => scm.stash(tabOf(req).cwd, req.body ?? {})));
  git.get("/tabs/:id/scm/diff", h((req) => scm.fileDiff(tabOf(req).cwd, String(req.query.path ?? ""), req.query.staged === "1")));
  git.post("/tabs/:id/scm/resolve", h((req) => scm.resolveConflict(tabOf(req).cwd, req.body ?? {})));
  git.post("/tabs/:id/scm/abort-merge", h((req) => scm.abortMerge(tabOf(req).cwd)));
  git.get("/tabs/:id/git/graph", h((req) => graph(tabOf(req).cwd, Number(req.query.limit) || 400, req.query.all !== "0")));
  git.get("/tabs/:id/git/commit/:hash", h((req) => commitDetail(tabOf(req).cwd, String(req.params.hash))));
  git.get("/tabs/:id/git/diff", h((req) => commitFileDiff(tabOf(req).cwd, String(req.query.hash ?? ""), String(req.query.file ?? ""))));
};

export default register;
