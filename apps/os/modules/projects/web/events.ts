// Open the project dialogs from any module, and react when a project was created or deleted
// (sessions opens a tab for a new project, for instance).
const OPEN_NEW = "projects:new";
const OPEN_DELETE = "projects:delete";
const CREATED = "projects:created";
const DELETED = "projects:deleted";

export interface CreatedEvent {
  id: string;
  url: string | null;
  /** The user asked to open it and set it up (toolchains, dependencies…). */
  setup: boolean;
}

const emit = <T,>(name: string, detail?: T) => window.dispatchEvent(new CustomEvent(name, { detail }));
const on = <T,>(name: string, fn: (d: T) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<T>).detail);
  window.addEventListener(name, h);
  return () => window.removeEventListener(name, h);
};

export const openNewProject = () => emit(OPEN_NEW);
export const openDeleteProject = (id: string) => emit(OPEN_DELETE, id);
export const onOpenNewProject = (fn: () => void) => on(OPEN_NEW, fn);
export const onOpenDeleteProject = (fn: (id: string) => void) => on(OPEN_DELETE, fn);
export const projectCreated = (d: CreatedEvent) => emit(CREATED, d);
export const onProjectCreated = (fn: (d: CreatedEvent) => void) => on(CREATED, fn);
export const projectDeleted = (d: { id: string; gone: boolean }) => emit(DELETED, d);
export const onProjectDeleted = (fn: (d: { id: string; gone: boolean }) => void) => on(DELETED, fn);
