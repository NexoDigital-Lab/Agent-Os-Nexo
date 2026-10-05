// How other modules reach a tab's editor: open a file at a line (architecture's assistant does), and read how
// tall the bottom panel is so floating UI can sit above it.
import { useSyncExternalStore } from "react";
import type { TabViewProps } from "../../sessions/web/slots";

const OPEN = "editor:open-file";
export interface OpenFileRequest {
  tabId: string;
  path: string;
  line?: number;
}

/** Shows the tab's editor with `path` open (at `line`): works whether the editor is on screen or not. */
export function openInEditor(view: TabViewProps, path: string, line?: number): void {
  const req: OpenFileRequest = { tabId: view.tab.id, path, line };
  view.handoff.give("open-file", req);
  view.go("editor");
  window.dispatchEvent(new CustomEvent(OPEN, { detail: req }));
}

export function onOpenFile(tabId: string, fn: (req: OpenFileRequest) => void): () => void {
  const h = (e: Event) => {
    const req = (e as CustomEvent<OpenFileRequest>).detail;
    if (req.tabId === tabId) fn(req);
  };
  window.addEventListener(OPEN, h);
  return () => window.removeEventListener(OPEN, h);
}

const heights = new Map<string, number>();
const subs = new Set<() => void>();

export function setPanelHeight(tabId: string, h: number): void {
  if (heights.get(tabId) === h) return;
  heights.set(tabId, h);
  for (const f of subs) f();
}

/** Px the editor's bottom panel takes in this tab (0 when closed or the editor isn't shown). */
export function usePanelHeight(tabId: string): number {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => heights.get(tabId) ?? 0,
  );
}
