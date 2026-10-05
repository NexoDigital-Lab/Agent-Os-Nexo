import { join } from "node:path";
import { findRoot } from "../core/paths.ts";
import { folder, readConfig, writeConfig } from "../core/config.ts";
import { FACTORY_SETS, installFactory, isFactorySet } from "../core/factory.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { generateAdapters } from "../core/adapters.ts";
import { loadPermissions } from "../core/permissions.ts";
import { listProjectDirs, refreshAdapters } from "../core/projects.ts";
import { nexoVersion } from "../core/version.ts";

/**
 * Refreshes factory items and AI files. `--factory <set>` changes which factory items the
 * environment takes (e.g. `all` to add the ones skipped at init); nothing is ever removed.
 */
export function update(opts: { root?: string; factory?: string }): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  if (opts.factory !== undefined) {
    if (!isFactorySet(opts.factory)) throw new Error(`Unknown factory set "${opts.factory}". Choose from: ${FACTORY_SETS.join(", ")}.`);
    config.factory = opts.factory;
  }
  const library = folder(root, config, "library");
  const report = installFactory(library, config.factory ?? "all");
  buildLibraryIndex(library);
  const from = config.nexo.version;
  config.nexo.version = nexoVersion();
  writeConfig(root, config);
  generateAdapters(root, config, root, loadPermissions(join(library, "permissions.json")));
  const projects = listProjectDirs(root, config);
  for (const dir of projects) refreshAdapters(root, config, dir);

  const lines = [`Nexo ${from} → ${config.nexo.version}`];
  if (report.installed.length) lines.push(`  new:     ${report.installed.join(", ")}`);
  if (report.updated.length) lines.push(`  updated: ${report.updated.join(", ")}`);
  if (report.skipped.length) lines.push(`  kept (owner is not nexo): ${report.skipped.join(", ")}`);
  lines.push(`  AI files refreshed for the root and ${projects.length} project folder(s).`);
  return lines.join("\n");
}
