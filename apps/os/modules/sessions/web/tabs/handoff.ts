// A per-tab mailbox for passing work between a tab's views (and from outside, e.g. "open the setup assistant
// in this new project's tab"): the sender puts a value and switches view, the receiving view takes it once.
import type { Handoff } from "../slots";

const boxes = new Map<string, Map<string, unknown>>();

const box = (tabId: string) => {
  let b = boxes.get(tabId);
  if (!b) boxes.set(tabId, (b = new Map()));
  return b;
};

export function handoffTo(tabId: string, key: string, value: unknown): void {
  box(tabId).set(key, value);
}

export function handoffFor(tabId: string): Handoff {
  return {
    give: (key, value) => box(tabId).set(key, value),
    take: <T,>(key: string) => {
      const b = box(tabId);
      const v = b.get(key) as T | undefined;
      b.delete(key);
      return v;
    },
  };
}
