import { call, seg } from "@os/lib/http";
import type { ExtOverview, ProjectExt } from "../server/extensions.ts";
export type { Ext, EditorPlugin } from "../server/catalog.ts";
export type { ExtOverview, ProjectExt, Rec as ExtRec } from "../server/extensions.ts";

export const extApi = {
  extensions: () => call<ExtOverview>("GET", "/api/extensions"),
  saveGeneralExt: (general: string[]) => call<{ general: string[] }>("PUT", "/api/extensions/general", { general }),
  installExt: (id: string) => call("POST", "/api/extensions/install", { id }),
  projectExt: (p: string) => call<ProjectExt>("GET", `/api/projects/${seg(p)}/extensions`),
  saveProjectExt: (p: string, body: { extensions: string[]; dismissed: string[] }) => call<ProjectExt>("PUT", `/api/projects/${seg(p)}/extensions`, body),
  syncVscode: (p: string) => call<ProjectExt>("POST", `/api/projects/${seg(p)}/extensions/sync`),
  recommendExt: (p: string) => call<ProjectExt>("POST", `/api/projects/${seg(p)}/extensions/recommend`),
};
