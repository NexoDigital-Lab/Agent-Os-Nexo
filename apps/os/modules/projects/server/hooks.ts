// How modules that depend on projects take part in a project's life without projects knowing them:
// sessions closes a project's tabs before its folder goes, docker offers to remove its dev container.
import type { Project } from "./projects.ts";

/** Extra facts for the delete dialog. */
export interface DeleteFacts {
  runningTabs?: number;
  openTabs?: number;
  /** Dev container name when one exists. */
  container?: string | null;
}

export interface DeleteOptions {
  /** Trash code/ only. */
  code: boolean;
  /** Trash the whole project folder: code, context, secrets. */
  folder: boolean;
  /** Delete the GitHub repository. */
  remote: boolean;
  /** Remove the project's dev container. */
  container: boolean;
}

export interface ProjectHooks {
  deleteFacts?: (p: Project) => Promise<DeleteFacts> | DeleteFacts;
  /** Before anything local is trashed (e.g. close the project's tabs). */
  beforeLocalDelete?: (p: Project) => Promise<void> | void;
  /** After local files went to the trash; push a line to `steps` for what was done. */
  afterLocalDelete?: (p: Project, opts: DeleteOptions, steps: string[]) => Promise<void> | void;
}

const hooks: ProjectHooks[] = [];

export function addProjectHooks(h: ProjectHooks): void {
  hooks.push(h);
}

export const projectHooks = (): readonly ProjectHooks[] => hooks;
