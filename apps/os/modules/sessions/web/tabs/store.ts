// The client side of the tabs: one shared, polled list (every 3 s while anything watches it), the active tab,
// and drafts waiting for a tab's composer. Other modules use openTab / focusTab / draftTo instead of reaching
// into the Tabs view.
import { useSyncExternalStore } from "react";
import { readStr, writeStr } from "@os/lib/storage";
import { goTo } from "../../../shell/web/nav";
import { sessionsApi, type Tab } from "../api";

export const WORK_VIEW = "work";

let tabs: Tab[] = [];
let active: string | null = readStr("tab");
const drafts = new Map<string, string>();
const subs = new Set<() => void>();
const tabListeners = new Set<(list: Tab[]) => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let snapshot = { tabs, active };

function changed() {
  snapshot = { tabs, active };
  for (const f of subs) f();
}

export async function refreshTabs(): Promise<Tab[]> {
  try {
    tabs = await sessionsApi.tabs();
    for (const fn of tabListeners) fn(tabs);
    changed();
  } catch {
    // keep the last known list
  }
  return tabs;
}

function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) {
    void refreshTabs();
    timer = setInterval(() => void refreshTabs(), 3000);
  }
  return () => {
    subs.delete(f);
    if (!subs.size) clearInterval(timer);
  };
}

/** Live tabs and the active one. */
export function useTabs(): { tabs: Tab[]; active: string | null } {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Called with every fresh list (notifications use it). */
export function onTabsUpdate(fn: (list: Tab[]) => void): () => void {
  tabListeners.add(fn);
  return () => tabListeners.delete(fn);
}

export function setActive(id: string | null): void {
  active = id;
  if (id) writeStr("tab", id);
  changed();
}

/** Shows a tab: switches to the Tabs view and selects it. */
export function focusTab(id: string): void {
  setActive(id);
  goTo(WORK_VIEW);
}

/** Opens a new tab on a project (or one of its worktrees) and shows it. */
export async function openTab(project: string, title = "", worktree?: string): Promise<string> {
  const { id } = await sessionsApi.openTab(project, title || worktree || project.split("/").pop()!, worktree);
  await refreshTabs();
  focusTab(id);
  return id;
}

export async function closeTab(id: string): Promise<void> {
  await sessionsApi.closeTab(id);
  tabs = tabs.filter((t) => t.id !== id);
  if (active === id) active = tabs[0]?.id ?? null;
  changed();
}

/** Puts text in a tab's composer (appended to what is there) and shows the tab's chat. */
export function draftTo(tabId: string, text: string): void {
  const prev = drafts.get(tabId);
  drafts.set(tabId, prev ? `${prev}\n\n${text}` : text);
  focusTab(tabId);
}

/** Takes (and clears) the draft waiting for a tab. */
export function takeDraft(tabId: string): string | null {
  const d = drafts.get(tabId) ?? null;
  drafts.delete(tabId);
  return d;
}

export const hasDraft = (tabId: string) => drafts.has(tabId);

/** Tells the server the user opened this tab (done/error goes back to idle). */
export const markSeen = (id: string) => void fetch(`/api/tabs/${id}/seen`, { method: "POST" }).catch(() => {});

/** Tabs that want the user's attention (the rail badge). */
export const attention = (list: Tab[]) => list.filter((t) => t.status === "needs_you" || t.status === "done" || t.status === "error").length;
