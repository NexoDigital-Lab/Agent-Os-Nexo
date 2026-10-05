// editor: files, search & replace, images, Run commands, toolchains and file icons of a tab's repository.
// Terminals, language servers, git, practice and setup are its submodules.
import express from "express";
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { openInEditor } from "../../projects/server/vscode.ts";
import { tabOf } from "../../sessions/server/index.ts";
import { createEntry, deleteEntry, imagePath, listFiles, moveEntry, readText, renameEntry, writeText } from "./files.ts";
import { ICONS_DIR, iconManifest } from "./icons.ts";
import { initRunner, runConfigs, saveRunConfigs, toolchains } from "./runner.ts";
import { replaceInRepo, searchRepo } from "./search.ts";

const register: ModuleServer = (ctx) => {
  initRunner(ctx.env);
  const api = ctx.api;

  // Files
  api.get("/tabs/:id/files", h((req) => listFiles(tabOf(req).cwd)));
  api.get("/tabs/:id/file", h((req) => readText(tabOf(req).cwd, String(req.query.path ?? ""))));
  api.put("/tabs/:id/file", h((req) => (writeText(tabOf(req).cwd, String(req.body.path), String(req.body.content ?? "")), ok)));
  api.post("/tabs/:id/fs", h((req) => {
    const root = tabOf(req).cwd;
    const { op, path: rel, name } = req.body ?? {};
    if (op === "file" || op === "dir") return createEntry(root, String(rel ?? ""), op);
    if (op === "rename") return renameEntry(root, String(rel ?? ""), String(name ?? ""));
    if (op === "delete") return deleteEntry(root, String(rel ?? ""));
    throw httpError(400, `Unknown operation: ${op}`);
  }));
  api.post("/tabs/:id/move", h((req) => moveEntry(tabOf(req).cwd, String(req.body.from ?? ""), String(req.body.toDir ?? ""))));
  api.get("/tabs/:id/image", (req, res) => {
    try {
      res.sendFile(imagePath(tabOf(req).cwd, String(req.query.path ?? "")));
    } catch (e) {
      const err = e as Error & { status?: number };
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });
  api.post("/tabs/:id/open-editor", h((req) => (openInEditor(tabOf(req).cwd, req.body.path ? String(req.body.path) : undefined, Number(req.body.line) || undefined), ok)));

  // Search & replace
  api.get("/tabs/:id/search", h((req) =>
    searchRepo(tabOf(req).cwd, { q: String(req.query.q ?? ""), regex: req.query.regex === "1", matchCase: req.query.case === "1", word: req.query.word === "1" }),
  ));
  api.post("/tabs/:id/replace", h((req) => replaceInRepo(tabOf(req).cwd, req.body ?? {})));

  // ▶ Run and toolchains
  api.get("/tabs/:id/run", h((req) => {
    const { project, cwd } = tabOf(req);
    return runConfigs(project, cwd);
  }));
  api.put("/tabs/:id/run", h((req) => saveRunConfigs(tabOf(req).project, req.body?.commands)));
  api.get("/tabs/:id/toolchains", h((req) => toolchains(tabOf(req).cwd)));

  // File icons for the tree (Material Icon Theme)
  api.get("/icons/manifest", h(() => iconManifest()));
  api.use("/icons/svg", express.static(ICONS_DIR, { maxAge: "7d", immutable: true }));
};

export default register;
