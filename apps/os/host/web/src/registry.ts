// Web side of the module system: every modules/**/web/index.tsx is a possible module; the host loads
// only the ones the server reports as active, then each contributes views (rail entries), slot items and
// translations. Modules talk to each other through slots (one module owns a slot and renders its items)
// or by importing a module they declare in `dependsOn`.
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { addMessages, type Language } from "./i18n";

/** A top-level view, shown as a rail button. */
export interface ViewDef {
  id: string;
  /** English label (translated with t()). */
  label: string;
  icon: LucideIcon;
  order?: number;
  component: ComponentType;
  /** Small number on the rail button (e.g. tabs waiting for the user). */
  useBadge?: () => number | null;
}

export interface WebModule {
  /** The app frame. Exactly one active module (shell) provides it. */
  root?: ComponentType;
  views?: ViewDef[];
  /** Items for slots other modules render: { "tab.side": [ … ] }. The owner of a slot defines its item type. */
  slots?: Record<string, unknown[]>;
  messages?: Partial<Record<Language, Record<string, string>>>;
  /** Runs once at boot, before the first render (e.g. apply the saved theme). */
  setup?: () => void | Promise<void>;
}

export const defineModule = (m: WebModule): WebModule => m;

const entries = import.meta.glob<{ default: WebModule }>("../../../modules/**/web/index.tsx");

/** "../../../modules/editor/submodules/lsp/web/index.tsx" → "editor/lsp" */
export function moduleIdOf(path: string): string {
  return path
    .replace(/^.*?\/modules\//, "")
    .replace(/\/web\/index\.tsx$/, "")
    .split("/submodules/")
    .join("/");
}

export interface Loaded {
  id: string;
  module: WebModule;
}

let loaded: Loaded[] = [];

/** Imports the web entries of the active modules, in the server's load order (dependencies first). */
export async function loadModules(active: string[]): Promise<Loaded[]> {
  const byId = new Map(Object.entries(entries).map(([path, load]) => [moduleIdOf(path), load]));
  const out: Loaded[] = [];
  for (const id of active) {
    const load = byId.get(id);
    if (!load) continue;
    const module = (await load()).default;
    addMessages(module.messages);
    out.push({ id, module });
  }
  loaded = out;
  for (const { module } of out) await module.setup?.();
  return out;
}

export const modules = (): Loaded[] => loaded;

/** Items every active module contributed to `slot`, in load order. */
export function slot<T>(name: string): T[] {
  return loaded.flatMap(({ module }) => (module.slots?.[name] ?? []) as T[]);
}

export function views(): ViewDef[] {
  return loaded.flatMap(({ module }) => module.views ?? []).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function isActive(id: string): boolean {
  return loaded.some((m) => m.id === id);
}
