// File explorer of the editor: the tree (compact folders, closed by default), inline create/rename, right-click
// menu, drag & drop moves and trash. It owns its UI state; the workspace only hears what changed on disk.
import { ChevronsDownUp, ChevronsUpDown, Clipboard, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { editorApi as api, type FileEntry, type Tab } from "./api";
import { allDirs, ancestors, buildTree, canDrop, parentOf, remapPath, type TreeNode } from "./fileTree";
import { NameInput, Tree, TreeMenu, type Edit } from "./TreeView";
import { t } from "@os/i18n";

export type ExplorerApi = { newIn: (kind: "file" | "dir") => void };

export function FileExplorer({ tab, files, active, onOpen, onChanged, onMoved, onDeleted, unsavedUnder, onError, apiRef }: {
  tab: Tab;
  files: FileEntry[];
  active: string | null;
  onOpen: (path: string) => void;
  onChanged: () => void; // something changed on disk: reload the file list
  onMoved: (from: string, to: string) => void; // move or rename: re-point open editors
  onDeleted: (path: string) => void; // file or folder went to the trash: close its editors
  unsavedUnder: (path: string) => number;
  onError: (msg: string) => void;
  apiRef: { current: ExplorerApi | null };
}) {
  const [filter, setFilter] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set()); // folders start closed
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(files.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()))), [files, filter]);
  const openAll = (paths: string[]) => setOpened((o) => new Set([...o, ...paths]));

  // The file shown in the editor always has its folders open.
  useEffect(() => {
    if (active) openAll(ancestors(active));
  }, [active]);

  // Compact rows ("src/app") are keyed by their deepest path; a new entry in "src" must attach to the row that shows it.
  const treeDirFor = (dir: string) => (dir ? allDirs(tree).find((d) => d === dir || d.startsWith(dir + "/")) ?? dir : "");

  /** Where "new file/folder" lands by default: the active file's folder, else the root. */
  const newIn = (kind: "file" | "dir", dir = active ? parentOf(active) : "") => {
    if (dir) openAll([...ancestors(dir + "/x")]);
    setEdit({ kind, dir: treeDirFor(dir) });
  };
  apiRef.current = { newIn };

  async function attempt(fn: () => Promise<unknown>) {
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      onError(e.message);
    }
  }

  /** Commits the inline tree input: create inside a folder, or rename in place. */
  const commitEdit = (value: string) => {
    const e = edit;
    setEdit(null);
    const name = value.trim();
    if (!e || !name || (e.kind === "rename" && name === e.path.split("/").pop())) return;
    attempt(async () => {
      if (e.kind === "rename") {
        const { path: to } = await api.renameEntry(tab.id, e.path, name);
        setOpened((o) => new Set([...o].map((p) => remapPath(p, e.path, to))));
        onMoved(e.path, to);
      } else {
        const { path: made } = await api.createEntry(tab.id, e.dir ? `${e.dir}/${name}` : name, e.kind);
        if (e.kind === "dir") openAll([...ancestors(made), made]);
        else onOpen(made);
      }
    });
  };

  const move = (from: string, toDir: string) =>
    attempt(async () => {
      const { path: to } = await api.moveFile(tab.id, from, toDir);
      setOpened((o) => new Set([...o].map((p) => remapPath(p, from, to))));
      onMoved(from, to);
    });

  /** What the second click on "Move to the trash" will do, unsaved work included. */
  const trashQuestion = (n: TreeNode) => {
    const unsaved = unsavedUnder(n.path);
    const what = n.children ? t("the folder {path} and everything in it", { path: n.path }) : n.path;
    return `${t("Move {what} to the trash?", { what })}${unsaved ? ` ${t("{n} open file(s) have unsaved changes that will be lost.", { n: unsaved })}` : ""}`;
  };

  const remove = (n: TreeNode) => {
    attempt(async () => {
      await api.deleteEntry(tab.id, n.path);
      onDeleted(n.path);
    });
  };

  const toggle = (p: string, forceOpen?: boolean) =>
    setOpened((c) => {
      const next = new Set(c);
      if (!forceOpen && next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const drag = {
    from: dragFrom,
    over: dragOver,
    setFrom: setDragFrom,
    setOver: setDragOver,
    drop: (toDir: string) => {
      const from = dragFrom;
      setDragFrom(null);
      setDragOver(null);
      if (from) move(from, toDir);
    },
  };

  const editInput = (depth: number, initial = "", kind: "file" | "dir" = "file") => (
    <NameInput key="edit" depth={depth} initial={initial} kind={kind} onDone={commitEdit} onCancel={() => setEdit(null)} />
  );
  const openMenu = (e: React.MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  };
  const dirOf = (n: TreeNode | null) => (n ? (n.children ? n.path : parentOf(n.path)) : "");

  return (
    <>
      <div className="eyebrow p-sec tree-head">
        <span>{t("Files")}</span>
        <span className="tree-tools">
          <button title={t("New file")} aria-label={t("New file")} onClick={() => newIn("file")}><FilePlus size={14} /></button>
          <button title={t("New folder")} aria-label={t("New folder")} onClick={() => newIn("dir")}><FolderPlus size={14} /></button>
          <button title={t("Expand all")} aria-label={t("Expand all")} onClick={() => setOpened(new Set(allDirs(tree)))}><ChevronsUpDown size={14} /></button>
          <button title={t("Collapse all")} aria-label={t("Collapse all")} onClick={() => setOpened(new Set())}><ChevronsDownUp size={14} /></button>
          <span>{t("lines")}</span>
        </span>
      </div>
      <input className="field p-filter" placeholder={t("Filter…")} aria-label={t("Filter…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div
        className={`ftree ${dragOver === "" ? "drop" : ""}`}
        onDragOver={(e) => {
          if (!canDrop(dragFrom, "")) return;
          e.preventDefault();
          if (dragOver !== "") setDragOver("");
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(null);
        }}
        onContextMenu={(e) => openMenu(e, null)}
        onDrop={(e) => {
          if (!canDrop(dragFrom, "")) return;
          e.preventDefault();
          drag.drop("");
        }}
      >
        <Tree nodes={tree} onOpen={onOpen} active={active} opened={filter ? new Set(allDirs(tree)) : opened} toggle={toggle} onMenu={openMenu} edit={edit} editInput={editInput} drag={drag} />
        {tree.length === 0 && edit?.kind !== "file" && edit?.kind !== "dir" && (
          <div className="tree-hint faint">{filter ? t("Nothing matches.") : <>{t("Empty repository:")} <FilePlus size={13} /> {t("to create the first file.")}</>}</div>
        )}
        {dragFrom && <div className="tree-hint faint">{t("Drop on a folder · down here = the repository root")}</div>}
      </div>
      {menu && (
        <TreeMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t("New file"), icon: FilePlus, run: () => newIn("file", dirOf(menu.node)) },
            { label: t("New folder"), icon: FolderPlus, run: () => newIn("dir", dirOf(menu.node)) },
            ...(menu.node
              ? [
                  { label: t("Rename"), icon: Pencil, run: () => setEdit({ kind: "rename", path: menu.node!.path }) },
                  { label: t("Copy path"), icon: Clipboard, run: () => navigator.clipboard?.writeText(menu.node!.path) },
                  { label: t("Move to the trash"), icon: Trash2, danger: true, confirm: trashQuestion(menu.node), run: () => remove(menu.node!) },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}
