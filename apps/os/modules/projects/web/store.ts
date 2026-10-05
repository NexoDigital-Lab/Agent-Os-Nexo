// One shared, polled list of projects for every view (refreshes every 5 s while anyone is looking).
import { useEffect, useSyncExternalStore } from "react";
import { projectsApi, type Project } from "./api";

let projects: Project[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export async function refreshProjects(): Promise<Project[]> {
  projects = await projectsApi.list().catch(() => projects);
  for (const fn of listeners) fn();
  return projects;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    void refreshProjects();
    timer = setInterval(() => void refreshProjects(), 5000);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useProjects(): Project[] {
  const list = useSyncExternalStore(subscribe, () => projects);
  useEffect(() => void refreshProjects(), []);
  return list;
}
