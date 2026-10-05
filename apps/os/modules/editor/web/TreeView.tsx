// The file tree's views: recursive rows (folders + files, drag & drop targets), the inline name input, and
// the right-click menu. State lives in FileExplorer.
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileIcon } from "./icons";
import { canDrop, parentOf, type TreeNode } from "./fileTree";
import { t } from "@os/i18n";

/** Inline name input in the tree: a new file/folder inside `dir`, or renaming `path`. */
export type Edit = { kind: "file" | "dir"; dir: string } | { kind: "rename"; path: string };

type TreeProps = {
  nodes: TreeNode[];
  onOpen: (p: string) => void;
  active: string | null;
  opened: Set<string>;
  toggle: (p: string, open?: boolean) => void;
  onMenu: (e: React.MouseEvent, n: TreeNode) => void;
  edit: Edit | null;
  editInput: (depth: number, initial?: string, kind?: "file" | "dir") => React.ReactNode;
  dir?: string; // folder these nodes live in ("" = repo root)
  drag: { from: string | null; over: string | null; setOver: (p: string | null) => void; setFrom: (p: string | null) => void; drop: (toDir: string) => void };
  depth?: number;
};

export function Tree(props: TreeProps) {
  const { nodes, onOpen, active, opened, toggle, onMenu, edit, editInput, drag, depth = 0, dir = "" } = props;
  const closed = { has: (p: string) => !opened.has(p) };
  const hover = useRef<{ path: string; t: number } | null>(null);
  const dragProps = (n: TreeNode, dir: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", n.path);
      drag.setFrom(n.path);
    },
    onDragEnd: () => { drag.setFrom(null); drag.setOver(null); },
    onDragOver: (e: DragEvent) => {
      if (!canDrop(drag.from, dir)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (drag.over !== dir) drag.setOver(dir);
      // Hovering a closed folder for a moment opens it, so nested targets stay reachable.
      if (n.children && closed.has(n.path)) {
        if (hover.current?.path !== n.path) hover.current = { path: n.path, t: Date.now() };
        else if (Date.now() - hover.current.t > 600) toggle(n.path, true);
      }
    },
    onDrop: (e: DragEvent) => {
      if (!canDrop(drag.from, dir)) return;
      e.preventDefault();
      e.stopPropagation();
      drag.drop(dir);
    },
  });
  const renaming = (n: TreeNode) => edit?.kind === "rename" && edit.path === n.path;
  return (
    <>
      {edit && edit.kind !== "rename" && edit.dir === dir && editInput(depth, "", edit.kind)}
      {nodes.map((n) =>
        n.children ? (
          <div key={n.path}>
            {renaming(n) ? editInput(depth, n.path.split("/").pop(), "dir") : <div
              className={`tree-row dir ${drag.over === n.path ? "drop" : ""} ${drag.from === n.path ? "dragging" : ""}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              title={n.path}
              onClick={() => toggle(n.path)}
              onContextMenu={(e) => onMenu(e, n)}
              {...dragProps(n, n.path)}
            >
              <span className="caret">{closed.has(n.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
              <FileIcon name={n.name.split("/").pop()!} folder open={!closed.has(n.path)} />
              <span className="nm">{n.name}</span>
              <span className="loc">{n.lines || ""}</span>
            </div>}
            {!closed.has(n.path) && (n.children.length > 0 ? <Tree {...props} nodes={n.children} dir={n.path} depth={depth + 1} /> : edit && edit.kind !== "rename" && edit.dir === n.path && editInput(depth + 1, "", edit.kind))}
          </div>
        ) : renaming(n) ? (
          <div key={n.path}>{editInput(depth, n.name, "file")}</div>
        ) : (
          <div
            key={n.path}
            className={`tree-row ${active === n.path ? "on" : ""} ${drag.from === n.path ? "dragging" : ""}`}
            style={{ paddingLeft: 20 + depth * 12 }}
            title={n.path}
            onClick={() => onOpen(n.path)}
            onContextMenu={(e) => onMenu(e, n)}
            {...dragProps(n, parentOf(n.path))}
          >
            <FileIcon name={n.name} />
            <span className="nm">{n.name}</span>
            <span className={`loc ${n.lines > 400 ? "big" : ""}`}>{n.lines || ""}</span>
          </div>
        ),
      )}
    </>
  );
}

/** Inline name field in the tree. The icon follows what you type, so the extension picks the file type. */
export function NameInput({ depth, initial, kind, onDone, onCancel }: { depth: number; initial: string; kind: "file" | "dir"; onDone: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    commit && v.trim() ? onDone(v) : onCancel();
  };
  const base = v.split("/").pop() || (kind === "dir" ? t("folder") : t("file"));
  return (
    <div className="tree-row editing" style={{ paddingLeft: (kind === "dir" ? 8 : 20) + depth * 12 }}>
      {kind === "dir" && <span className="caret"><ChevronRight size={14} /></span>}
      <FileIcon name={base} folder={kind === "dir"} />
      <input
        autoFocus
        className="tree-input mono"
        value={v}
        placeholder={kind === "dir" ? t("folder-name") : t("file.ext")}
        aria-label={kind === "dir" ? t("New folder") : t("New file")}
        spellCheck={false}
        onFocus={(e) => {
          // Renaming "main.go" selects "main", like VS Code.
          const dot = initial.lastIndexOf(".");
          if (initial && kind === "file" && dot > 0) e.currentTarget.setSelectionRange(0, dot);
          else e.currentTarget.select();
        }}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

/** `confirm`: the item asks once more (its label becomes this question) before it runs. */
type MenuItem = { label: string; icon?: LucideIcon; run: () => void; danger?: boolean; confirm?: string };

export function TreeMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", esc);
    };
  }, []);
  const [armed, setArmed] = useState<string | null>(null);
  // Keep it on screen near the bottom/right edges.
  const top = Math.min(y, window.innerHeight - items.length * 30 - 12);
  const left = Math.min(x, window.innerWidth - 210);
  return (
    <div className="ctx-menu" style={{ top, left }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <button
          key={it.label}
          className={`${it.danger ? "danger" : ""}${armed === it.label ? " armed" : ""}`}
          onClick={() => {
            if (it.confirm && armed !== it.label) return setArmed(it.label);
            onClose();
            it.run();
          }}
        >
          {it.icon && <it.icon size={14} />} {armed === it.label ? it.confirm : it.label}
        </button>
      ))}
    </div>
  );
}
