import { call } from "@os/lib/http";
import type { Tab } from "../../sessions/web/api";
import type { SshHost, SshHostInput, SshSessionInfo, VaultState } from "../server/types.ts";
import type { SshBinding } from "../server/index.ts";
export type { SshAuth, SshConnState, SshHost, SshHostInput, SshPlan, SshPlanStatus, SshPlanStep, SshSessionInfo, VaultState } from "../server/types.ts";
export type { SshBinding } from "../server/index.ts";

export const sshApi = {
  state: () => call<{ state: VaultState }>("GET", "/api/ssh/state"),
  setup: (password: string) => call<{ state: VaultState }>("POST", "/api/ssh/setup", { password }),
  unlock: (password: string) => call<{ state: VaultState }>("POST", "/api/ssh/unlock", { password }),
  lock: () => call<{ state: VaultState }>("POST", "/api/ssh/lock"),
  hosts: () => call<SshHost[]>("GET", "/api/ssh/hosts"),
  createHost: (h: SshHostInput) => call<SshHost>("POST", "/api/ssh/hosts", h),
  updateHost: (id: string, h: SshHostInput) => call<SshHost>("PUT", `/api/ssh/hosts/${encodeURIComponent(id)}`, h),
  deleteHost: (id: string) => call<{ ok: boolean }>("DELETE", `/api/ssh/hosts/${encodeURIComponent(id)}`),
  open: (id: string) => call<{ tabId: string }>("POST", `/api/ssh/hosts/${encodeURIComponent(id)}/open`),
  session: (tabId: string) => call<SshSessionInfo>("GET", `/api/ssh/sessions/${tabId}`),
  connect: (tabId: string) => call<SshSessionInfo>("POST", `/api/ssh/sessions/${tabId}/connect`),
  share: (tabId: string, shared: boolean) => call<SshSessionInfo>("POST", `/api/ssh/sessions/${tabId}/share`, { shared }),
  decidePlan: (planId: string, approve: boolean) => call<{ ok: boolean }>("POST", `/api/ssh/plans/${encodeURIComponent(planId)}`, { approve }),
};

/** The SSH binding of a tab (`null` for normal tabs). */
export const sshOf = (tab: Tab): SshBinding | null => {
  const b = tab.meta?.ssh as SshBinding | undefined;
  return b && typeof b.hostId === "string" ? b : null;
};

/** Make invisible / control characters visible (⟨U+XXXX⟩) so the command you approve is exactly the text you read. Keeps \n and \t. */
export const visibleChars = (text: string) =>
  text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) =>
    c === "\n" || c === "\t" ? c : `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟩`,
  );
