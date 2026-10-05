// Pure helpers for the file tree: build it from the flat file list, fold single-child folder chains, and the
// small path predicates the explorer's drag & drop and inline editing need.
import type { FileEntry } from "./api";

export type TreeNode = { name: string; path: string; lines: number; children?: TreeNode[] };

export function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", lines: 0, children: [] };
  for (const f of files) {
    let node = root;
    const parts = f.path.split("/");
    parts.forEach((part, i) => {
      const leaf = i === parts.length - 1 && !f.dir;
      node.lines += f.lines;
      let next = node.children!.find((c) => c.name === part && !!c.children === !leaf);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join("/"), lines: 0, ...(leaf ? {} : { children: [] }) };
        node.children!.push(next);
      }
      if (leaf) next.lines = f.lines;
      node = next;
    });
  }
  const sort = (n: TreeNode[]) => {
    n.sort((a, b) => (!!b.children === !!a.children ? a.name.localeCompare(b.name) : b.children ? 1 : -1));
    n.forEach((c) => c.children && sort(c.children));
  };
  sort(root.children!);
  return root.children!.map(compact);
}

/** Folds single-subfolder chains into one row ("src/app/components"), like VS Code's compact folders. */
function compact(n: TreeNode): TreeNode {
  if (!n.children) return n;
  let cur = n;
  let name = n.name;
  while (cur.children!.length === 1 && cur.children![0].children) {
    cur = cur.children![0];
    name += "/" + cur.name;
  }
  return { ...cur, name, lines: n.lines, children: cur.children!.map(compact) };
}

export const allDirs = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.children ? [n.path, ...allDirs(n.children)] : []));
export const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
export const isUnder = (p: string, dir: string) => p === dir || p.startsWith(dir + "/");

/** Can `from` be dropped into folder `dir`? Not into itself, a descendant, or where it already is. */
export const canDrop = (from: string | null, dir: string) => !!from && dir !== from && !dir.startsWith(from + "/") && parentOf(from) !== dir;

/** Every folder above `p` — compact rows are keyed by their deepest path, so all prefixes are needed. */
export const ancestors = (p: string) => p.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/** After a move/rename of `from` to `to`, where does path `p` live now? */
export const remapPath = (p: string, from: string, to: string) => (isUnder(p, from) ? to + p.slice(from.length) : p);
