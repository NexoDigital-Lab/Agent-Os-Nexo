// Per-tab review tray, persisted in localStorage and shared by every diff surface through a tiny pub/sub.
import { useCallback, useSyncExternalStore } from "react";
import { readLS, writeLS } from "@os/lib/storage";
import { draftTo } from "../tabs/store";
import type { ReviewComment } from "./logic";

const key = (tabId: string) => `review:${tabId}`;
const cache = new Map<string, ReviewComment[]>();
const subs = new Set<() => void>();

function get(tabId: string): ReviewComment[] {
  let v = cache.get(tabId);
  if (!v) cache.set(tabId, (v = readLS<ReviewComment[]>(key(tabId), [])));
  return v;
}

function set(tabId: string, next: ReviewComment[]) {
  cache.set(tabId, next);
  writeLS(key(tabId), next);
  subs.forEach((f) => f());
}

export const reviewActions = {
  add(tabId: string, c: Omit<ReviewComment, "id" | "at">) {
    set(tabId, [...get(tabId), { ...c, id: Math.random().toString(36).slice(2, 9), at: Date.now() }]);
  },
  edit(tabId: string, id: string, text: string) {
    set(tabId, get(tabId).map((c) => (c.id === id ? { ...c, text } : c)));
  },
  remove(tabId: string, id: string) {
    set(tabId, get(tabId).filter((c) => c.id !== id));
  },
  clear(tabId: string) {
    set(tabId, []);
  },
};

export function useReview(tabId: string): ReviewComment[] {
  const subscribe = useCallback((f: () => void) => (subs.add(f), () => void subs.delete(f)), []);
  return useSyncExternalStore(subscribe, () => get(tabId));
}

/** Hands text to the tab's chat composer and switches that tab to the chat view. */
export const sendDraft = (tabId: string, text: string) => draftTo(tabId, text);
