// projects: the environment's projects (/api/projects, /api/github/repos).
import { join } from "node:path";
import { h, httpError, ok, trash } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { FEATURE_PRIORITIES, FEATURE_SIZES, FEATURE_STATUSES, FEATURE_TYPES, featuresDir, listFeatures, readFeature, setFeatureField, writeFeature, type NewFeature } from "./features.ts";
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
    if (f.priority !== undefined && !FEATURE_PRIORITIES.includes(f.priority)) throw httpError(400, "Invalid priority");
    if (f.status !== undefined && !FEATURE_STATUSES.includes(f.status)) throw httpError(400, "Invalid status");
    if (f.title.length > 200) throw httpError(400, "The title is longer than 200 characters");
    for (const k of ["criteria", "files"] as const) {
      const v = f[k];
      if (v !== undefined && (!Array.isArray(v) || v.length > 50 || !v.every((x) => typeof x === "string" && x.length <= 500))) throw httpError(400, `${k} must be a list of short texts`);
    }
    return { slug: writeFeature(dirOf(id(req.params.id)), f) };
  }));
  api.patch("/projects/:id/features/:slug", h((req) => {
    const dir = dirOf(id(req.params.id));
    const body = req.body as { status?: string; priority?: string };
    const valid: Array<["status" | "priority", readonly string[]]> = [["status", FEATURE_STATUSES], ["priority", FEATURE_PRIORITIES]];
    const changes = valid.filter(([k]) => body[k] !== undefined);
    if (!changes.length || changes.some(([k, allowed]) => !allowed.includes(String(body[k])))) throw httpError(400, "Invalid status or priority");
    try {
      for (const [k] of changes) setFeatureField(dir, String(req.params.slug), k, String(body[k]));
    } catch {
      throw httpError(404, "Feature not found");
    }
    return ok;
  }));
  // A feature file goes to the trash, never a plain delete.
  api.delete("/projects/:id/features/:slug", h(async (req) => {
    const dir = dirOf(id(req.params.id));
    const slug = String(req.params.slug);
    if (readFeature(dir, slug) === null) throw httpError(404, "Feature not found");
    await trash(join(featuresDir(dir), `${slug}.md`), `context/features/${slug}.md`);
    return ok;
  }));
};

export default register;
