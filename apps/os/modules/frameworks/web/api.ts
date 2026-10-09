// Typed client for /api/frameworks: list, add, enable, default, hooks approval, remove.
import { call } from "@os/lib/http";
import type { FrameworkInfo, FrameworksList } from "../../../host/server/frameworks.ts";

export type { FrameworkInfo, FrameworksList };

export const frameworksApi = {
  list: () => call<FrameworksList>("GET", "/api/frameworks"),
  add: (source: string, name?: string) => call<FrameworksList>("POST", "/api/frameworks/add", { source, name: name || undefined }),
  setEnabled: (name: string, enabled: boolean) => call<FrameworksList>("POST", `/api/frameworks/${encodeURIComponent(name)}/enabled`, { enabled }),
  setDefault: (name: string) => call<FrameworksList>("POST", "/api/frameworks/default", { name }),
  /** Approving sends the commands the user saw: the server refuses if they changed meanwhile. */
  setHooks: (name: string, approved: boolean, seen: string[]) => call<FrameworksList>("POST", `/api/frameworks/${encodeURIComponent(name)}/hooks`, { approved, seen }),
  remove: (name: string) => call<FrameworksList>("DELETE", `/api/frameworks/${encodeURIComponent(name)}`),
};
