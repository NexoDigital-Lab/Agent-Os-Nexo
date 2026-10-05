// Page zoom for the desktop app (Tauri webview): Ctrl +/−/0 like a browser, remembered between launches.
// In a regular browser this is a no-op: the browser's own zoom already does the job.
import { useEffect, useState } from "react";
import { readLS, writeLS } from "@os/lib/storage";

type TauriGlobal = {
  core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  webview?: { getCurrentWebview: () => { setZoom: (z: number) => Promise<void> } };
};
const tauri = () => (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;

export const inDesktopApp = () => !!tauri()?.webview;

const MIN = 0.5;
const MAX = 2;
const clamp = (z: number) => (Number.isFinite(z) ? Math.min(MAX, Math.max(MIN, Math.round(z * 10) / 10)) : 1);

export function useZoom() {
  const [zoom, setZoomState] = useState(() => clamp(readLS("zoom", 1)));
  const enabled = inDesktopApp();

  useEffect(() => {
    if (!enabled) return;
    // set_page_zoom (desktop app) also makes WebKitGTK re-lay out the page, so a zoom change can't leave the view cut
    // off at the bottom; an older app without it falls back to the plain webview zoom.
    const t = tauri()!;
    const plain = () => t.webview!.getCurrentWebview().setZoom(zoom).catch(() => {});
    if (t.core) t.core.invoke("set_page_zoom", { level: zoom }).catch(plain);
    else plain();
    writeLS("zoom", zoom);
  }, [zoom, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") setZoomState((z) => clamp(z + 0.1));
      else if (e.key === "-") setZoomState((z) => clamp(z - 0.1));
      else if (e.key === "0") setZoomState(1);
      else return;
      e.preventDefault();
      e.stopPropagation(); // keep xterm from also getting Ctrl+- as ^_
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);

  return { enabled, zoom, set: (z: number) => setZoomState(clamp(z)) };
}
