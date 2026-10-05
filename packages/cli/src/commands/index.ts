import { findRoot } from "../core/paths.ts";
import { folder, readConfig } from "../core/config.ts";
import { buildLibraryIndex } from "../core/libindex.ts";

export function index(opts: { root?: string }): string {
  const root = findRoot(opts.root);
  buildLibraryIndex(folder(root, readConfig(root), "library"));
  return "library/index.json rebuilt.";
}
