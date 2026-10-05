// Tiny module-level store: which SSH tabs currently share their console with the agent. SshSide writes it from its
// poll, and each tab's badge polls its own tab while the console is not open; both read it with useSyncExternalStore.
import { useEffect, useSyncExternalStore } from "react";
import { sshApi } from "./api";

let shared: ReadonlySet<string> = new Set();
const subs = new Set<() => void>();

export function setSshShared(tabId: string, value: boolean) {
  if (shared.has(tabId) === value) return;
  const next = new Set(shared);
  if (value) next.add(tabId);
  else next.delete(tabId);
  shared = next;
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f));

/** Reactive set of shared SSH tab ids. */
export const useSshShared = () => useSyncExternalStore(subscribe, () => shared);

/** Poll an SSH tab (every 5 s) so the tab bar shows the shared state even when its console is not open. */
export function useSshSharedPoll(tabId: string | null) {
  useEffect(() => {
    if (!tabId) return;
    let alive = true;
    const run = () => sshApi.session(tabId).then((i) => alive && setSshShared(tabId, !!i.shared)).catch(() => {}); // locked / 404: keep the last known value
    run();
    const timer = setInterval(run, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tabId]);
}
