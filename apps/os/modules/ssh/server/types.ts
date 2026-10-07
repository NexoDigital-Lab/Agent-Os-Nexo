// Shared shapes for the SSH feature (server ↔ web). Secrets never appear in any type the API returns.

export type SshAuth = "password" | "key" | "local"; // local = the user's own ~/.ssh keys / agent, nothing stored

/** A saved access as the UI sees it: everything except the secret. */
export type SshHost = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  hasSecret: boolean; // a password / private key is stored (write-only: it is never sent back)
  hasPassphrase: boolean; // key auth: the key's passphrase is stored too
  project: string | null; // optional agent-os-nexo project the session tab opens in
};

/** Body to create/update a host. `secret`/`passphrase`: omitted = keep the stored one, "" = clear it. */
export type SshHostInput = Omit<SshHost, "id" | "hasSecret" | "hasPassphrase"> & { secret?: string; passphrase?: string };

export type VaultState = "setup" | "locked" | "unlocked";

export type SshConnState = "connecting" | "connected" | "closed";

/** The SSH console attached to a tab, as the UI sees it. */
export type SshSessionInfo = {
  tabId: string;
  hostId: string;
  hostName: string;
  state: SshConnState;
  shared: boolean; // the agent may read the console / run approved commands
  busy: boolean; // a command the agent launched is still running
};

/** One step of a plan the agent asks the user to approve before running non-read-only commands. */
export type SshPlanStep = { command: string; why: string };
export type SshPlanStatus = "pending" | "approved" | "rejected";
/** A plan as it travels in the tab's chat (a module event of type "plan"). */
export type SshPlan = { summary: string; steps: SshPlanStep[]; status: SshPlanStatus };
