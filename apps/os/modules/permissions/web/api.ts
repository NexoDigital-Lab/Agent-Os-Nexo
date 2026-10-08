import { call } from "@os/lib/http";
import type { Decision, PermissionsView } from "../server/permissions.ts";
export type { Decision, Permissions, PermissionsView, Rules } from "../server/permissions.ts";

export type Area = "files.read" | "files.edit" | "commands";

export const permissionsApi = {
  view: (project: string | null) => call<PermissionsView>("GET", `/api/permissions${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  /** decision null removes the pattern. */
  rule: (project: string | null, area: Area, decision: Decision | null, pattern: string) =>
    call<PermissionsView>("POST", "/api/permissions/rule", { project, area, decision, pattern }),
  setting: (project: string | null, key: string, decision: Decision) => call<PermissionsView>("POST", "/api/permissions/setting", { project, key, decision }),
};
