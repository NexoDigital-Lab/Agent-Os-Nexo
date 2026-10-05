import { call } from "@os/lib/http";
import type { SessionUsage, Summary } from "../../sessions/server/usage.ts";
export type { Bucket, SessionUsage, Summary } from "../../sessions/server/usage.ts";

export const monitorApi = {
  summary: (days: number) => call<Summary>("GET", `/api/usage/summary?days=${days}`),
  sessions: (days: number) => call<SessionUsage[]>("GET", `/api/usage/sessions?days=${days}`),
};
