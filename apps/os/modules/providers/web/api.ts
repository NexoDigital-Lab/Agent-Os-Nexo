// Typed client for /api/providers: list detected providers, save the enabled set, re-test one.
import { call } from "@os/lib/http";
import type { DetectedProvider, ProviderId, ProvidersFile } from "../../../host/server/providers.ts";

export type { DetectedProvider, ProviderId, ProvidersFile };

export interface ProvidersState extends ProvidersFile {
  providers: DetectedProvider[];
}

export const providersApi = {
  list: () => call<ProvidersState>("GET", "/api/providers"),
  setEnabled: (enabled: ProviderId[], def: ProviderId | null) =>
    call<ProvidersState>("POST", "/api/providers/enabled", { enabled, default: def }),
  testProvider: (id: ProviderId) => call<{ provider: DetectedProvider }>("POST", "/api/providers/test", { id }),
};
