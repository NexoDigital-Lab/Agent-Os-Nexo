// Visual-bug gallery: paste (Ctrl+V), drop or pick screenshots of what looks wrong; each gets an optional note.
// They land in os/data/visual-bugs/, where an agent reads them when asked to fix visual bugs.
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { locale } from "@os/i18n";
import { ConfirmDelete } from "@os/lib/ConfirmDelete";
import { call } from "@os/lib/http";
import { prepareImage } from "@os/lib/images";
import type { VisualBug } from "../server/bugs.ts";
import { t } from "@os/i18n";

const fmt = (iso: string) => new Date(iso).toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const api = {
  visualBugs: () => call<VisualBug[]>("GET", "/api/visual-bugs"),
  addVisualBug: async (blob: Blob) => {
    const res = await fetch("/api/visual-bugs", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data as VisualBug;
  },
  noteVisualBug: (name: string, note: string) => call("PATCH", `/api/visual-bugs/${name}`, { note }),
  deleteVisualBug: (name: string) => call("DELETE", `/api/visual-bugs/${name}`),
};

export function VisualBugs() {
  const [bugs, setBugs] = useState<VisualBug[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const depth = useRef(0); // dragenter/dragleave fire per child element: count them instead of trusting the target
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(() => api.visualBugs().then(setBugs).catch((e) => setError(String(e.message ?? e))), []);
  useEffect(() => void load(), [load]);

  const add = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      setError("");
      setBusy((n) => n + images.length);
      for (const f of images) {
        try {
          await api.addVisualBug(await prepareImage(f));
        } catch (e) {
          setError(String((e as Error).message ?? e));
        } finally {
          setBusy((n) => n - 1);
        }
      }
      load();
    },
    [load],
  );

  // Ctrl+V anywhere in the view, unless typing in a note.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest("textarea, input")) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    closeBtn.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      opener.current?.focus();
    };
  }, [zoom]);

  const saveNote = (b: VisualBug, note: string) => {
    if (note === b.note) return;
    api.noteVisualBug(b.name, note).then(load).catch((e) => {
      // Deleted meanwhile: nothing to save, just refresh the list.
      if (/not found/i.test(String(e.message))) load();
      else setError(String(e.message ?? e));
    });
  };
  const remove = (b: VisualBug) => api.deleteVisualBug(b.name).then(load).catch((e) => setError(String(e.message ?? e)));

  return (
    <div
      className="page vb"
      onDragEnter={() => (depth.current++, setDrag(true))}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDrag(false);
      }}
      onDrop={(e) => (e.preventDefault(), (depth.current = 0), setDrag(false), add(Array.from(e.dataTransfer.files)))}
    >
      <h1>{t("Visual bugs")}</h1>
      <p className="sub">
        {t("Paste a screenshot with")} <kbd>Ctrl</kbd>+<kbd>V</kbd>{t(", drop it or pick it. They are saved in")}{" "}
        <span className="mono">os/data/visual-bugs/</span>{t(": ask an agent to fix the visual bugs and it reads them from there.")}
      </p>

      <button className={`vb-drop ${drag ? "on" : ""}`} onClick={() => picker.current?.click()}>
        <ImagePlus size={22} strokeWidth={1.6} />
        <span>{busy ? t("Uploading {n}…", { n: busy }) : t("Paste, drop or pick screenshots")}</span>
      </button>
      <input ref={picker} aria-label={t("Pick screenshots")} type="file" accept="image/*" multiple hidden onChange={(e) => (add(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      {error && <p className="vb-error">{error}</p>}

      {bugs.length === 0 && !busy ? (
        <p className="empty">{t("No screenshots yet. When something looks broken in the app, take a screenshot and paste it here.")}</p>
      ) : (
        <div className="vb-grid">
          {bugs.map((b) => (
            <figure key={b.name} className="vb-card">
              <button className="vb-thumb" onClick={(e) => ((opener.current = e.currentTarget), setZoom(b.name))} title={t("View large")} aria-label={t("View large")}>
                <img src={`/api/visual-bugs/${b.name}`} alt={b.note || t("Screenshot without a note")} loading="lazy" />
              </button>
              <figcaption>
                <textarea
                  className="field"
                  rows={3}
                  aria-label={t("Screenshot note")}
                  placeholder={t("What's wrong? (optional)")}
                  defaultValue={b.note}
                  onBlur={(e) => saveNote(b, e.target.value.trim())}
                />
                <div className="vb-meta">
                  <span className="faint">{fmt(b.createdAt)}</span>
                  {/* mousedown would blur the note textarea and save it just as the capture is deleted */}
                  <span onMouseDown={(e) => e.preventDefault()}>
                    <ConfirmDelete title={t("Delete screenshot")} name={b.note ? `"${b.note.slice(0, 24)}"` : fmt(b.createdAt)} onConfirm={() => remove(b)} />
                  </span>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {zoom && (
        <div className="vb-zoom" onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label={t("Screenshot, large")}>
          <img src={`/api/visual-bugs/${zoom}`} alt="" />
          <button ref={closeBtn} className="btn ghost vb-close" aria-label={t("Close")}>
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
