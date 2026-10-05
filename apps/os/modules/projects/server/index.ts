// projects: the environment's projects (/api/projects, /api/github/repos).
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { FEATURE_SIZES, FEATURE_STATUSES, FEATURE_TYPES, listFeatures, readFeature, setFeatureField, writeFeature, type NewFeature } from "./features.ts";
import { cloneProject, createProject, deleteCheck, deleteProject, listRemoteRepos } from "./lifecycle.ts";
import { initProjects, listProjects, projectDiff, projectDir, projectPath } from "./projects.ts";

/** A known project's folder, or 404. */
export function dirOf(id: string): string {
  const dir = projectDir(id);
  if (!dir) throw httpError(404, `Unknown project: ${id}`);
  return dir;
}

/** A known project's repository (code/), or 404. */
export function repo(id: string): string {
  const p = projectPath(id);
  if (!p) throw httpError(404, `Unknown project or no code/ yet: ${id}`);
  return p;
}

const register: ModuleServer = (ctx) => {
  initProjects(ctx.env);
  const api = ctx.api;
  const id = (p: unknown) => String(p);

  api.get("/projects", h(() => listProjects()));
  api.post("/projects", h((req) => createProject(ctx.env, req.body)));
  api.post("/projects/clone", h((req) => cloneProject(ctx.env, req.body ?? {})));
  api.get("/github/repos", h(() => listRemoteRepos()));
  api.get("/projects/:id/delete-check", h((req) => deleteCheck(id(req.params.id))));
  api.post("/projects/:id/delete", h((req) => deleteProject(id(req.params.id), req.body ?? {})));
  api.get("/projects/:id/diff", h((req) => projectDiff(repo(id(req.params.id)))));

  api.get("/projects/:id/features", h((req) => listFeatures(dirOf(id(req.params.id)))));
  api.get("/projects/:id/features/:slug", h((req) => {
    const md = readFeature(dirOf(id(req.params.id)), String(req.params.slug));
    if (md === null) throw httpError(404, "Feature not found");
    return { markdown: md };
  }));
  api.post("/projects/:id/features", h((req) => {
    const f = req.body as NewFeature;
    if (!f?.title?.trim()) throw httpError(400, "A feature needs a title");
    if (!FEATURE_TYPES.includes(f.type) || !FEATURE_SIZES.includes(f.size)) throw httpError(400, "Invalid type or size");
    return { slug: writeFeature(dirOf(id(req.params.id)), f) };
  }));
  api.patch("/projects/:id/features/:slug", h((req) => {
    const dir = dirOf(id(req.params.id));
    const { status } = req.body as { status?: string };
    if (!FEATURE_STATUSES.includes(status as (typeof FEATURE_STATUSES)[number])) throw httpError(400, "Invalid status");
    try {
      setFeatureField(dir, String(req.params.slug), "status", status!);
    } catch {
      throw httpError(404, "Feature not found");
    }
    return ok;
  }));
};

export default register;
