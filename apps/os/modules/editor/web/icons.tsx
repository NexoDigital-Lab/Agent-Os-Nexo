// Material Icon Theme icons (same set and rules as the VS Code extension), served by the agent-os server.
import { useEffect, useState } from "react";
import { editorApi as api, type IconManifest } from "./api";
import { languageOf } from "./monaco";

let manifest: IconManifest | null = null;
let loading: Promise<IconManifest> | null = null;

function useManifest() {
  const [m, setM] = useState(manifest);
  useEffect(() => {
    if (m) return;
    loading ??= api.iconManifest().then((x) => (manifest = x));
    loading.then(setM).catch(() => {});
  }, []);
  return m;
}

/** VS Code order: exact file name, then the longest matching extension ("d.ts" before "ts"), then language. */
function fileIcon(m: IconManifest, name: string): string {
  const n = name.toLowerCase();
  if (m.fileNames[n]) return m.fileNames[n];
  const parts = n.split(".");
  for (let i = 1; i < parts.length; i++) {
    const hit = m.fileExtensions[parts.slice(i).join(".")];
    if (hit) return hit;
  }
  return m.languageIds[languageOf(n)] ?? m.file;
}

function folderIcon(m: IconManifest, name: string, open: boolean): string {
  const n = name.toLowerCase();
  return (open ? m.folderNamesOpen[n] ?? m.folderOpen : m.folderNames[n] ?? m.folder);
}

/** `name` is the last path segment; folders pass `open` to get the expanded variant. */
export function FileIcon({ name, folder, open = false }: { name: string; folder?: boolean; open?: boolean }) {
  const m = useManifest();
  if (!m) return <span className="ficon" />;
  const svg = folder ? folderIcon(m, name, open) : fileIcon(m, name);
  return <img className="ficon" src={`/api/icons/svg/${svg}`} alt="" draggable={false} />;
}
