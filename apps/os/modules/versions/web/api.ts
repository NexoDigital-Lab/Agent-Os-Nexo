import { call } from "@os/lib/http";
import type { BuildsState } from "../server/builds.ts";
export type { Build, BuildsState } from "../server/builds.ts";

export const versionsApi = {
  state: () => call<BuildsState>("GET", "/api/versions"),
  pin: (version: string | null) => call<BuildsState>("PUT", "/api/versions/pin", { version }),
};
