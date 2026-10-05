// VS Code's global shortcuts for the workspace. One table feeds both the window listener and Monaco (which
// swallows keys while it has focus), so a shortcut is defined once.
import { useEffect, useRef } from "react";
import { monaco } from "./monaco";

export type Shortcut = { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; run: () => void };

// KeyboardEvent.code → Monaco KeyCode for the keys the table uses.
const MONACO_KEY: Record<string, number> = {
  KeyP: monaco.KeyCode.KeyP, KeyF: monaco.KeyCode.KeyF, KeyB: monaco.KeyCode.KeyB, KeyS: monaco.KeyCode.KeyS,
  Backquote: monaco.KeyCode.Backquote, Backslash: monaco.KeyCode.Backslash,
};

const matches = (s: Shortcut, e: KeyboardEvent) =>
  e.code === s.key && !!s.ctrl === (e.ctrlKey || e.metaKey) && !!s.shift === e.shiftKey && !!s.alt === e.altKey;

/** Window-level listener; `table` may change every render (it's read through a ref). */
export function useShortcuts(table: Shortcut[]) {
  const ref = useRef(table);
  ref.current = table;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const s = ref.current.find((x) => matches(x, e));
      if (s) {
        e.preventDefault();
        s.run();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return ref;
}

/** Registers the same table inside a Monaco editor (call from onMount). */
export function bindToMonaco(ed: monaco.editor.IStandaloneCodeEditor, table: { current: Shortcut[] }) {
  for (const s of table.current) {
    const code = MONACO_KEY[s.key];
    if (code === undefined) continue;
    const mods = (s.ctrl ? monaco.KeyMod.CtrlCmd : 0) | (s.shift ? monaco.KeyMod.Shift : 0) | (s.alt ? monaco.KeyMod.Alt : 0);
    // Look the handler up at press time: the table is rebuilt every render.
    ed.addCommand(mods | code, () => table.current.find((x) => x.key === s.key && !!x.ctrl === !!s.ctrl && !!x.shift === !!s.shift && !!x.alt === !!s.alt)?.run());
  }
}
