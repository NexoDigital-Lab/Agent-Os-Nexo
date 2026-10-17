import { call } from "@os/lib/http";
import type { SessionUsage, Summary } from "../../sessions/server/usage.ts";
export type { Bucket, SessionUsage, Summary } from "../../sessions/server/usage.ts";

export const monitorApi = {
  summary: (days: number, provider = "all") => call<Summary>("GET", `/api/usage/summary?days=${days}&provider=${provider}`),
  sessions: (days: number, provider = "all") => call<SessionUsage[]>("GET", `/api/usage/sessions?days=${days}&provider=${provider}`),
};
