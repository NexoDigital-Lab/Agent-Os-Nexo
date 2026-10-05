import { join } from "node:path";
import { findRoot } from "../core/paths.ts";
import { folder, readConfig, writeConfig } from "../core/config.ts";
import { installFactory } from "../core/factory.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { generateAdapters } from "../core/adapters.ts";
import { loadPermissions } from "../core/permissions.ts";
import { listProjectDirs, refreshAdapters } from "../core/projects.ts";
import { nexoVersion } from "../core/version.ts";

export function update(opts: { root?: string }): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const library = folder(root, config, "library");
  const report = installFactory(library);
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
