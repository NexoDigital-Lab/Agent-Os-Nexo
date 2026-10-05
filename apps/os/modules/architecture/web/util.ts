// Pure helpers for the proposed-folder tree (Architecture). The server validates again; this keeps the UI honest.
import { t } from "@os/i18n";
import { renderMarkdown } from "@os/lib/markdown";
import type { ArchNode } from "./api";

export const NAME_RE = /^[A-Za-z0-9._@-][A-Za-z0-9._@ -]{0,79}$/;
export const MAX_NODES = 500;

export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export const childrenOf = (nodes: ArchNode[], parentId: string | null) =>
  nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));

/** ids of `id` and everything under it. */
export function subtreeIds(nodes: ArchNode[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parentId && out.has(n.parentId) && !out.has(n.id)) (out.add(n.id), (grew = true));
  }
  return out;
}

export function pathOf(nodes: ArchNode[], id: string | null): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = nodes.find((x) => x.id === cur);
    if (!n) break;
    parts.unshift(n.name);
    cur = n.parentId;
  }
  return "/" + parts.join("/");
}

/** Error text when `name` can't be used for `id` under `parentId`, else "". */
export function nameError(nodes: ArchNode[], id: string | null, parentId: string | null, name: string): string {
  if (!NAME_RE.test(name)) return t("Invalid name: use letters, numbers, . _ @ - (no “/” or “..”, up to 80 characters).");
  if (name.includes("..")) return t("The name cannot contain “..”.");
  if (nodes.some((n) => n.id !== id && n.parentId === parentId && n.name.toLowerCase() === name.toLowerCase()))
    return t("There is already a folder “{name}” at that level.", { name });
  return "";
}

export function uniqueName(nodes: ArchNode[], parentId: string | null, base: string): string {
  let name = base;
  for (let i = 2; nameError(nodes, null, parentId, name); i++) name = `${base}-${i}`;
  return name;
}

export const md = (s: string) => renderMarkdown(s);
