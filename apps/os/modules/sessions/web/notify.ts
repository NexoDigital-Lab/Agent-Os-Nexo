// Notifications when a tab finishes or needs the user while they are not looking at it: native in the desktop app
// (tauri-plugin-notification), the Web Notification API in a browser, and the page title ("(N) agent-os-nexo") as the
// last resort. Fed by the shared tab list (tabs/store.ts).
import { useEffect } from "react";
import { t as i18n } from "@os/i18n";
import { readStr } from "@os/lib/storage";
import type { Tab } from "./api";
import { attention, focusTab, onTabsUpdate, useTabs, WORK_VIEW } from "./tabs/store";

// ---- notifications ----
type TauriNotification = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<string>;
  sendNotification: (o: { title?: string; body?: string }) => void;
};
const tauriNotif = () => (window as unknown as { __TAURI__?: { notification?: TauriNotification } }).__TAURI__?.notification;

const seeded = new Set<string>(); // "<tab>:<statusSince>" of transitions already handled (one notification each)
let first = true;
let nativeOk: Promise<boolean> | undefined;

const looking = (id: string, list: Tab[]) => {
  if (!document.hasFocus() || document.visibilityState !== "visible") return false;
  if (readStr("view") !== WORK_VIEW) return false;
  return (readStr("tab") ?? list[0]?.id) === id;
};

async function native(title: string, body: string): Promise<boolean> {
  const n = tauriNotif();
  if (!n) return false;
  try {
    nativeOk ??= n.isPermissionGranted().then(async (g) => g || (await n.requestPermission()) === "granted");
    if (!(await nativeOk)) return false;
    n.sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

function web(title: string, body: string, tabId: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const n = new Notification(title, { body, tag: tabId });
    n.onclick = () => {
      window.focus();
      focusTab(tabId);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

async function notify(t: Tab) {
  const title = "agent-os-nexo";
  const body = `${t.title}: ${t.status === "needs_you" ? i18n("needs you") : t.status === "error" ? i18n("finished with an error") : i18n("finished")}`;
  if (await native(title, body)) return;
  web(title, body, t.id);
}

export function onTabs(list: Tab[]) {
  for (const t of list) {
    if (t.status !== "needs_you" && t.status !== "done" && t.status !== "error") continue;
    const key = `${t.id}:${t.status}:${t.statusSince}`;
    if (seeded.has(key)) continue;
    seeded.add(key);
    if (first || looking(t.id, list)) continue; // what was already pending at load, or what the user is looking at
    void notify(t);
  }
  first = false;
  setTitle(attention(list));
}

const BASE_TITLE = typeof document === "undefined" ? "agent-os-nexo" : document.title || "agent-os-nexo";
function setTitle(n: number) {
  if (typeof document !== "undefined") document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
}

/** Browsers only grant notification permission after a gesture: ask once, on the first click or key press. */
export function useNotificationPermission() {
  useEffect(() => {
    if (tauriNotif() || typeof Notification === "undefined" || Notification.permission !== "default") return;
    const ask = () => void Notification.requestPermission().catch(() => {});
    window.addEventListener("pointerdown", ask, { once: true });
    window.addEventListener("keydown", ask, { once: true });
    return () => {
      window.removeEventListener("pointerdown", ask);
      window.removeEventListener("keydown", ask);
    };
  }, []);
}

/** Always mounted (shell overlay): keeps the tab list polled so notifications fire from any view. */
export function TabWatcher() {
  useTabs();
  useNotificationPermission();
  useEffect(() => onTabsUpdate(onTabs), []);
  return null;
}
