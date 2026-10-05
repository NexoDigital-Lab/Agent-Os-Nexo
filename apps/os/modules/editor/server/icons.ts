// Material Icon Theme (the VS Code extension's own icon set + its name/extension rules) for the file tree.
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
export const ICONS_DIR = path.join(path.dirname(require.resolve("material-icon-theme/package.json")), "icons");

type IconMap = Record<string, string>;
export type IconManifest = {
  file: string; folder: string; folderOpen: string;
  fileNames: IconMap; fileExtensions: IconMap; languageIds: IconMap; folderNames: IconMap; folderNamesOpen: IconMap;
};
let manifest: IconManifest | null = null;

/** Rule maps with each icon id resolved to its svg filename, computed once. */
export function iconManifest(): IconManifest {
  if (manifest) return manifest;
  const m = require("material-icon-theme").generateManifest();
  const svg = (id: string) => path.basename(m.iconDefinitions[id]?.iconPath ?? `${id}.svg`);
  const map = (o: IconMap = {}) => Object.fromEntries(Object.entries(o).map(([k, id]) => [k.toLowerCase(), svg(id)]));
  manifest = {
    file: svg(m.file), folder: svg(m.folder), folderOpen: svg(m.folderExpanded),
    fileNames: map(m.fileNames), fileExtensions: map(m.fileExtensions), languageIds: map(m.languageIds),
    folderNames: map(m.folderNames), folderNamesOpen: map(m.folderNamesExpanded),
  };
  return manifest;
}
