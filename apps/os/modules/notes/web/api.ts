import { call } from "@os/lib/http";
import type { Draft, Note, Proposal } from "../server/notes.ts";
export type { Draft, Note, Proposal };

export const notesApi = {
  notes: () => call<Note[]>("GET", "/api/notes"),
  saveNote: (n: Partial<Note>) => (n.id ? call<Note>("PUT", `/api/notes/${n.id}`, n) : call<Note>("POST", "/api/notes", n)),
  deleteNote: (id: string) => call("DELETE", `/api/notes/${id}`),
  analyzeNotes: (ids: string[]) =>
    call<{ project: string; exists: boolean; summary: string; proposals: Proposal[]; cost: number }>("POST", "/api/notes/analyze", { ids }),
  accept: (project: string, proposals: Proposal[]) => call<{ features: string[]; drafts: number }>("POST", "/api/notes/accept", { project, proposals }),
  drafts: () => call<Draft[]>("GET", "/api/notes/drafts"),
  promoteDrafts: (project: string) => call<{ features: string[] }>("POST", "/api/notes/drafts/promote", { project }),
  deleteDraft: (id: string) => call("DELETE", `/api/notes/drafts/${id}`),
};
