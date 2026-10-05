import { call, seg } from "@os/lib/http";
import type { VisualBug } from "../server/bugs.ts";
export type { VisualBug } from "../server/bugs.ts";

export const visualBugsApi = {
  visualBugs: () => call<VisualBug[]>("GET", "/api/visual-bugs"),
  /** The raw image as the body (the server reads its Content-Type). */
  addVisualBug: async (blob: Blob) => {
    const res = await fetch("/api/visual-bugs", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data as VisualBug;
  },
  noteVisualBug: (name: string, note: string) => call("PATCH", `/api/visual-bugs/${seg(name)}`, { note }),
  deleteVisualBug: (name: string) => call("DELETE", `/api/visual-bugs/${seg(name)}`),
};
