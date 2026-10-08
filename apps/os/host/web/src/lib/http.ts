// The one HTTP client every module uses for /api calls: JSON in, JSON out, errors as ApiError.
import type { HostInfo, ModuleRow, Prefs } from "../../../server/routes.ts";
export type { HostInfo, ModuleRow, Prefs };

/** An API error; `locked` is set when the SSH vault is locked (401 `{ locked: true }`). */
export class ApiError extends Error {
  locked = false;
  /** This browser has no access to this run of agent-os-nexo (open its access link: `nexo os open`). */
  access = false;
  status = 0;
}
export const isLocked = (e: unknown) => !!(e as ApiError | undefined)?.locked;

export async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin", // the SSH vault cookie (HttpOnly) must travel with every call
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(data.error ?? res.statusText);
    err.status = res.status;
    err.locked = res.status === 401 && data.locked === true;
    err.access = res.status === 401 && data.access === true;
    throw err;
  }
  return data;
}

/** URL path segment, encoded. */
export const seg = (s: string) => encodeURIComponent(s);

/** The host's own API: version, modules, preferences. */
export const hostApi = {
  info: () => call<HostInfo>("GET", "/api/os/info"),
  modules: () => call<ModuleRow[]>("GET", "/api/os/modules"),
  restart: () => call<{ ok: true; boot: string }>("POST", "/api/os/restart"),
  setModule: (id: string, enabled: boolean) => call<{ ok: true; restart: true }>("PUT", "/api/os/modules", { id, enabled }),
  prefs: () => call<Prefs>("GET", "/api/os/prefs"),
  savePrefs: (patch: Prefs) => call<Prefs>("PUT", "/api/os/prefs", patch),
};
