import { call, seg } from "@os/lib/http";
import type { Diff } from "../../projects/server/projects.ts";
import type { Ev, TabInfo, WorkMode } from "../server/agent.ts";
import type { Recommendation, Skill } from "../server/skills.ts";
import type { AgentStatus, WorkStatus } from "../server/status.ts";
export type { AgentStatus, Diff, Ev, Recommendation, Skill, WorkMode, WorkStatus };
export type Tab = TabInfo;
export type TaskEv = Extract<Ev, { kind: "task" }>;
export type TaskStatus = TaskEv["status"];
export type Mode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export interface HistoryItem {
  id: string;
  title: string;
  project: string;
  cwd: string | null;
  source: string;
  start: string | null;
  end: string | null;
  active: boolean;
  cost: number;
  agents: number;
  tabId: string | null;
}

export const sessionsApi = {
  tabs: () => call<Tab[]>("GET", "/api/tabs"),
  openTab: (project: string, title: string, worktree?: string) => call<{ id: string }>("POST", "/api/tabs", { project, title, worktree }),
  renameTab: (id: string, title: string) => call("PATCH", `/api/tabs/${id}`, { title }),
  closeTab: (id: string) => call("DELETE", `/api/tabs/${id}`),
  send: (id: string, body: { prompt: string; skills: string[]; images: string[]; mode: Mode; model?: string; workMode?: WorkMode }) =>
    call("POST", `/api/tabs/${id}/send`, body),
  permission: (id: string, permId: string, allow: boolean, always = false) => call("POST", `/api/tabs/${id}/permission`, { permId, allow, always }),
  upload: async (id: string, blob: Blob) => {
    const res = await fetch(`/api/tabs/${id}/uploads`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data as { name: string; url: string };
  },
  deleteUpload: (id: string, name: string) => call("DELETE", `/api/tabs/${id}/uploads/${name}`),
  quick: (id: string, text: string, target?: string) => call<{ queued: boolean }>("POST", `/api/tabs/${id}/quick`, { text, target }),
  stopTask: (id: string, taskId: string) => call("POST", `/api/tabs/${id}/tasks/${taskId}/stop`),
  interrupt: (id: string) => call("POST", `/api/tabs/${id}/interrupt`),
  tabDiff: (id: string) => call<Diff>("GET", `/api/tabs/${id}/diff`),
  history: (limit = 10) => call<HistoryItem[]>("GET", `/api/sessions/history?limit=${limit}`),
  resume: (sessionId: string) => call<{ id: string; reused: boolean; forked?: boolean }>("POST", `/api/sessions/history/${seg(sessionId)}/resume`),
  skills: () => call<Skill[]>("GET", "/api/sessions/skills"),
  savePrefs: (disabled: string[], pinned: string[]) => call("PUT", "/api/sessions/skills/prefs", { disabled, pinned }),
  recommend: (task: string, project: string) => call<{ skills: Recommendation[]; cost: number }>("POST", "/api/sessions/skills/recommend", { task, project }),
};

export { prepareImage } from "@os/lib/images";
