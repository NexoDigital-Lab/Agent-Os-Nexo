import { call, seg } from "@os/lib/http";
import type { Diff, Project, Worktree } from "../server/projects.ts";
import type { DeleteCheck, NewProject, RemoteRepo } from "../server/lifecycle.ts";
import type { Feature, NewFeature } from "../server/features.ts";
export type { DeleteCheck, Diff, Feature, NewFeature, NewProject, Project, RemoteRepo, Worktree };

export interface Created {
  id: string;
  url: string | null;
  steps: string[];
}

export const projectsApi = {
  list: () => call<Project[]>("GET", "/api/projects"),
  create: (body: NewProject) => call<Created>("POST", "/api/projects", body),
  clone: (body: { repo: string; ws?: string; name?: string }) => call<Created>("POST", "/api/projects/clone", body),
  remoteRepos: () => call<RemoteRepo[]>("GET", "/api/github/repos"),
  deleteCheck: (id: string) => call<DeleteCheck>("GET", `/api/projects/${seg(id)}/delete-check`),
  remove: (id: string, body: { code: boolean; folder: boolean; remote: boolean; container: boolean; confirm: string }) =>
    call<{ steps: string[]; gone: boolean }>("POST", `/api/projects/${seg(id)}/delete`, body),
  diff: (id: string) => call<Diff>("GET", `/api/projects/${seg(id)}/diff`),
  features: (id: string) => call<Feature[]>("GET", `/api/projects/${seg(id)}/features`),
  feature: (id: string, slug: string) => call<{ markdown: string }>("GET", `/api/projects/${seg(id)}/features/${seg(slug)}`),
  addFeature: (id: string, f: NewFeature) => call<{ slug: string }>("POST", `/api/projects/${seg(id)}/features`, f),
  setFeatureStatus: (id: string, slug: string, status: Feature["status"]) =>
    call("PATCH", `/api/projects/${seg(id)}/features/${seg(slug)}`, { status }),
};
