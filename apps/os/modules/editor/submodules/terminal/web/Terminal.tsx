import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { currentPalette, onPaletteChange, xtermTheme } from "../../../../themes/web/theme";

/**
 * One server-side shell of the tab (reattaches with its scrollback). `onOutput` gets every chunk (for the Problems
 * parser), `onInput` what you type, `onReset` fires before a reattach replays the scrollback.
 */
export function Terminal({ tabId, termId, url, onOutput, onInput, onReset, onExit }: {
  tabId: string;
  termId?: string;
  url?: string; // ws path override (e.g. /api/ssh/term/:tabId); default: the tab's own terminal
  onOutput?: (text: string) => void;
  onInput?: (data: string) => void;
  onReset?: () => void;
  onExit?: () => void;
}) {
  const cb = useRef({ onOutput, onInput, onReset, onExit });
  cb.current = { onOutput, onInput, onReset, onExit };
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: xtermTheme(currentPalette()),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    // Ctrl+` toggles the panel (window listener); the shell must not also get the keystroke.
    term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.code === "Backquote"));
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${url ?? `/api/tabs/${tabId}/term/${termId}`}`);
    cb.current.onReset?.();
    const resize = () => {
      try {
        fit.fit();
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      } catch {}
    };
    ws.onopen = () => {
      resize();
      term.focus();
    };
    let disposed = false;
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      term.write(e.data);
      cb.current.onOutput?.(e.data);
    };
    ws.onclose = () => {
      if (disposed) return; // we closed it (panel hidden / unmount): the shell keeps running on the server
      term.write("\r\n\x1b[2m[terminal cerrada]\x1b[0m\r\n");
      cb.current.onExit?.();
    };
    const sub = term.onData((data) => {
      cb.current.onInput?.(data);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });
    const ro = new ResizeObserver(resize);
    ro.observe(host.current!);
    const offPalette = onPaletteChange((p) => (term.options.theme = xtermTheme(p)));
    return () => {
      disposed = true;
      offPalette();
      ro.disconnect();
      sub.dispose();
      ws.close();
      term.dispose();
    };
  }, [tabId, termId, url]);

  return <div className="xterm-host" ref={host} />;
}
