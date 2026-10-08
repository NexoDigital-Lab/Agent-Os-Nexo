import { call } from "@os/lib/http";
import type { ContextDoc, ContextFile } from "../server/context.ts";
export type { ContextDoc, ContextFile };

const base = (project: string) => `/api/projects/${encodeURIComponent(project)}/context`;

export const contextApi = {
  list: (project: string) => call<ContextFile[]>("GET", base(project)),
  read: (project: string, path: string) => call<ContextDoc>("GET", `${base(project)}/file?path=${encodeURIComponent(path)}`),
  save: (project: string, path: string, content: string, mtime?: number) => call<ContextDoc>("PUT", `${base(project)}/file`, { path, content, mtime }),
  /** No path: the whole context/ folder. */
  open: (project: string, path?: string) => call("POST", `${base(project)}/open`, path ? { path } : {}),
};
