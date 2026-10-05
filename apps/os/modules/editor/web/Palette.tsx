import { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon } from "./icons";
import { t } from "@os/i18n";

export type Command = { id: string; label: string; key?: string; run: () => void };

/** Fuzzy subsequence score: consecutive and start-of-segment matches rank higher. -1 = no match. */
function score(text: string, q: string): number {
  const t = text.toLowerCase();
  let s = 0, ti = 0, prev = -2;
  for (const ch of q.toLowerCase()) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    s += i === prev + 1 ? 3 : 1;
    if (i === 0 || "/._- ".includes(t[i - 1])) s += 2;
    prev = i;
    ti = i + 1;
  }
  return s - t.length / 100;
}

/**
 * Ctrl+P (files) and Ctrl+Shift+P (commands) in one box, like VS Code: typing ">" switches to commands,
 * ":<n>" jumps to a line.
 */
export function Palette({ mode, files, commands, onFile, onLine, onClose }: {
  mode: "files" | "commands";
  files: string[];
  commands: Command[];
  onFile: (path: string) => void;
  onLine: (n: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(mode === "commands" ? ">" : "");
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const isCmd = q.startsWith(">");
  const isLine = q.startsWith(":");
  const items = useMemo(() => {
    const term = isCmd ? q.slice(1).trim() : q.trim();
    if (isLine) return [];
    if (isCmd) return commands.map((c) => ({ c, s: term ? score(c.label, term) : 0 })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => ({ kind: "cmd" as const, ...x.c }));
    return files.map((f) => ({ f, s: term ? score(f, term) : 0 })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 60).map((x) => ({ kind: "file" as const, id: x.f, label: x.f }));
  }, [q, files, commands]);

  useEffect(() => {
    setSel(0);
  }, [q]);
  // Braces matter: scrollIntoView returns a Promise in recent Chrome, and an effect must return nothing or a cleanup.
  useEffect(() => {
    list.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const pick = (i: number) => {
    const it = items[i];
    if (isLine) {
      const n = parseInt(q.slice(1));
      if (n > 0) onLine(n);
    } else if (it?.kind === "cmd") it.run();
    else if (it) onFile(it.id);
    else return;
    onClose();
  };

  return (
    <div className="palette-bg" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="field mono"
          value={q}
          placeholder={t("Search a file · > commands · :line")}
          aria-label={t("Search a file · > commands · :line")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, items.length - 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
            if (e.key === "Enter") pick(sel);
          }}
        />
        <div className="palette-list" ref={list}>
          {isLine && <div className="palette-item faint">{t("Enter to go to line {n}", { n: parseInt(q.slice(1)) || "…" })}</div>}
          {!isLine && items.length === 0 && <div className="palette-item faint">{t("Nothing matches.")}</div>}
          {items.map((it, i) => (
            <div key={it.id} className={`palette-item ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}>
              {it.kind === "file" ? (
                <>
                  <FileIcon name={it.label.split("/").pop()!} />
                  <span>{it.label.split("/").pop()}</span>
                  <span className="faint dir">{it.label.split("/").slice(0, -1).join("/")}</span>
                </>
              ) : (
                <>
                  <span>{it.label}</span>
                  {it.key && <span className="faint kbd">{it.key}</span>}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
