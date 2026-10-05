// In-app replacements for window.prompt / window.confirm (rule M6): those block the page, can't be styled or
// translated, and the desktop app's webview may not show them at all. askText / askConfirm return a promise; the
// shell mounts <DialogHost /> once, and requests made while one is open wait their turn.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { t } from "../i18n";

type Request =
  | { kind: "text"; message: string; initial: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; message: string; confirmText: string; danger: boolean; resolve: (v: boolean) => void };

let queue: Request[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const push = (r: Request) => ((queue = [...queue, r]), changed());
const pop = () => ((queue = queue.slice(1)), changed());

/** Asks for a line of text; null when cancelled. */
export const askText = (message: string, initial = ""): Promise<string | null> =>
  new Promise((resolve) => push({ kind: "text", message, initial, resolve }));

/** Asks yes or no; `confirmText` labels the yes button ("Close anyway"). */
export const askConfirm = (message: string, confirmText = t("OK"), danger = false): Promise<boolean> =>
  new Promise((resolve) => push({ kind: "confirm", message, confirmText, danger, resolve }));

export function DialogHost() {
  const req = useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => queue[0] ?? null);
  return req ? <Dialog key={queue.length + req.message} req={req} /> : null;
}

function Dialog({ req }: { req: Request }) {
  const [value, setValue] = useState(req.kind === "text" ? req.initial : "");
  const uid = useId();
  const box = useRef<HTMLFormElement>(null);
  const finish = (ok: boolean) => {
    if (req.kind === "text") req.resolve(ok ? value.trim() || null : null);
    else req.resolve(ok);
    pop();
  };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, button[type=submit]")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), finish(false));
    window.addEventListener("keydown", onKey);
    return () => (window.removeEventListener("keydown", onKey), prev?.focus?.());
  }, []);
  return (
    <div className="modal-bg" onClick={() => finish(false)}>
      <form ref={box} className="modal" role="dialog" aria-modal="true" aria-labelledby={`${uid}-m`} onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), finish(true))}>
        <p id={`${uid}-m`} style={{ margin: 0 }}>{req.message}</p>
        {req.kind === "text" && <input className="field" value={value} aria-labelledby={`${uid}-m`} onChange={(e) => setValue(e.target.value)} />}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn ghost" onClick={() => finish(false)}>{t("Cancel")}</button>
          <button type="submit" className={`btn ${req.kind === "confirm" && req.danger ? "danger" : "primary"}`}>{req.kind === "confirm" ? req.confirmText : t("OK")}</button>
        </div>
      </form>
    </div>
  );
}
