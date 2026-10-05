// Folder-tree editor of the proposed architecture: select, add child, rename inline, delete, drag to nest.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus, Pencil } from "lucide-react";
import type { ArchNode } from "./api";
import { ConfirmDelete } from "@os/lib/ConfirmDelete";
import { childrenOf, MAX_NODES, nameError, newId, subtreeIds, uniqueName } from "./util";
import { t } from "@os/i18n";

export function ArchTree({ nodes, selected, onSelect, onChange, onError, addRequest }: {
  nodes: ArchNode[];
  selected: string | null; // null = the repo root row
  onSelect: (id: string | null) => void;
  onChange: (nodes: ArchNode[]) => void;
  onError: (msg: string) => void;
  addRequest?: { parentId: string | null; nonce: number } | null; // the toolbar's "Nueva carpeta"
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const cancelled = useRef(false);
  const [over, setOver] = useState<string | "root" | null>(null);

  useEffect(() => {
    if (renaming) cancelled.current = false;
  }, [renaming]);
  function addChild(parentId: string | null) {
    if (nodes.length >= MAX_NODES) return onError(t("At most {n} folders.", { n: MAX_NODES }));
    onError("");
    const id = newId();
    onChange([...nodes, { id, name: uniqueName(nodes, parentId, "new-folder"), parentId, rules: "" }]);
    if (parentId) setCollapsed((c) => { const n = new Set(c); n.delete(parentId); return n; });
    onSelect(id);
    setRenaming(id);
    setDraft("");
  }

  const addRef = useRef(addChild);
  addRef.current = addChild;
  useEffect(() => {
    if (addRequest) addRef.current(addRequest.parentId);
  }, [addRequest?.nonce]);

  function commitRename(n: ArchNode) {
    if (cancelled.current) return void (cancelled.current = false);
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === n.name) return;
    const err = nameError(nodes, n.id, n.parentId, name);
    if (err) return onError(err);
    onError("");
    onChange(nodes.map((x) => (x.id === n.id ? { ...x, name } : x)));
  }

  function remove(n: ArchNode) {
    const gone = subtreeIds(nodes, n.id);
    onChange(nodes.filter((x) => !gone.has(x.id)));
    if (selected && gone.has(selected)) onSelect(n.parentId);
    onError("");
  }

  const canDrop = (target: string | null) => {
    if (!dragId) return false;
    const d = nodes.find((x) => x.id === dragId);
    if (!d || d.parentId === target) return false;
    return target === null || !subtreeIds(nodes, dragId).has(target);
  };

  function drop(target: string | null) {
    const id = dragId;
    setDragId(null);
    setOver(null);
    if (!id || !canDrop(target)) return;
    const n = nodes.find((x) => x.id === id)!;
    const err = nameError(nodes, id, target, n.name);
    if (err) return onError(t("Cannot move: {error}", { error: err }));
    onError("");
    onChange(nodes.map((x) => (x.id === id ? { ...x, parentId: target } : x)));
    if (target) setCollapsed((c) => { const n = new Set(c); n.delete(target); return n; });
  }

  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDrop(target)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(target ?? "root");
    },
    onDragLeave: () => setOver((o) => (o === (target ?? "root") ? null : o)),
    onDrop: (e: React.DragEvent) => (e.preventDefault(), drop(target)),
  });

  function row(n: ArchNode, depth: number) {
    const kids = childrenOf(nodes, n.id);
    const open = !collapsed.has(n.id);
    return (
      <li key={n.id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={selected === n.id}>
        <div
          className={`arch-row${selected === n.id ? " on" : ""}${over === n.id ? " over" : ""}${dragId === n.id ? " dragging" : ""}`}
          style={{ paddingLeft: 6 + depth * 16 }}
          draggable={renaming !== n.id}
          onDragStart={(e) => (e.dataTransfer.setData("text/plain", n.id), (e.dataTransfer.effectAllowed = "move"), setDragId(n.id))}
          onDragEnd={() => (setDragId(null), setOver(null))}
          {...dropProps(n.id)}
        >
          <button
            className="btn sm ghost arch-twist"
            aria-label={open ? `Contraer ${n.name}` : `Expandir ${n.name}`}
            style={{ visibility: kids.length ? "visible" : "hidden" }}
            onClick={() => setCollapsed((c) => { const x = new Set(c); if (!x.delete(n.id)) x.add(n.id); return x; })}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <Folder size={14} className="faint" aria-hidden />
          {renaming === n.id ? (
            <input
              className="field arch-rename"
              autoFocus
              value={draft}
              aria-label={t("New name for {name}", { name: n.name })}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => commitRename(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(n);
                else if (e.key === "Escape") (cancelled.current = true, setRenaming(null));
              }}
            />
          ) : (
            <button className="arch-name mono" onClick={() => onSelect(n.id)} onDoubleClick={() => (setRenaming(n.id), setDraft(n.name))}>
              {n.name}
            </button>
          )}
          <span className="arch-acts">
            <button className="btn sm ghost" title={t("Add subfolder")} aria-label={t("Add a subfolder in {name}", { name: n.name })} onClick={() => addChild(n.id)}><FolderPlus size={14} /></button>
            <button className="btn sm ghost" title={t("Rename")} aria-label={t("Rename {name}", { name: n.name })} onClick={() => (setRenaming(n.id), setDraft(n.name))}><Pencil size={14} /></button>
            <ConfirmDelete
              title={t("Delete folder")}
              name={n.name}
              note={kids.length ? t("Also deletes all its subfolders and their rules") : t("Deletes the folder and its rules")}
              onConfirm={() => remove(n)}
            />
          </span>
        </div>
        {kids.length > 0 && open && (
          <ul role="group" className="arch-ul">
            {kids.map((k) => row(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul role="tree" aria-label={t("Proposed folder structure")} className="arch-ul arch-tree">
      <li role="treeitem" aria-selected={selected === null}>
        <div className={`arch-row${selected === null ? " on" : ""}${over === "root" ? " over" : ""}`} {...dropProps(null)}>
          <span className="arch-twist" />
          <Folder size={14} className="faint" aria-hidden />
          <button className="arch-name mono" onClick={() => onSelect(null)}>/(repo)</button>
          <span className="arch-acts">
            <button className="btn sm ghost" title={t("Add folder at the root")} aria-label={t("Add folder at the root")} onClick={() => addChild(null)}><FolderPlus size={14} /></button>
          </span>
        </div>
        <ul role="group" className="arch-ul">
          {childrenOf(nodes, null).map((n) => row(n, 1))}
        </ul>
      </li>
    </ul>
  );
}
