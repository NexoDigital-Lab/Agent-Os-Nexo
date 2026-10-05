// Applies a palette to the page (CSS custom properties on :root) and derives the themes of the parts that
// don't read CSS: the Monaco editor, xterm terminals and the git graph's lane colors.
import { useSyncExternalStore } from "react";
import { hostApi } from "@os/lib/http";
import { readStr, writeStr } from "@os/lib/storage";
import { DEFAULT_PALETTE, paletteById, type Palette } from "./palettes";

const CACHE_KEY = "theme"; // localStorage: paints the right palette before the server answers

let current: Palette = paletteById(readStr(CACHE_KEY) ?? DEFAULT_PALETTE);
const listeners = new Set<() => void>();

const mix = (color: string, pct: number, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;

/** A chevron for <select>, drawn in the palette's muted text color. */
const chevron = (stroke: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(stroke)}' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export function applyPalette(p: Palette): void {
  const c = p.colors;
  const vars: Record<string, string> = {
    "--bg": c.bg, "--bg-2": c.bg2, "--panel": c.panel, "--panel-2": c.panel2, "--line": c.line, "--line-2": c.line2,
    "--text": c.text, "--text-2": c.text2, "--text-3": c.text3,
    "--accent": c.accent, "--accent-ink": c.accentInk, "--accent-text": c.accentText, "--accent-dim": mix(c.accent, 14),
    "--ok": c.ok, "--ok-dim": mix(c.ok, 13), "--bad": c.bad, "--bad-dim": mix(c.bad, 13),
    "--info": c.info, "--info-dim": mix(c.info, 11), "--warn": c.warn, "--violet": c.violet,
    "--add": c.add, "--del": c.del, "--brand": p.brand,
    "--sans": p.fonts.sans, "--display": p.fonts.display,
    "--select-chevron": chevron(c.text3),
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = p.dark ? "dark" : "light";
  root.dataset.palette = p.id;
}

export function currentPalette(): Palette {
  return current;
}

/** Applies and remembers the palette (in the environment's prefs, shared by every build and browser). */
export async function choosePalette(id: string): Promise<void> {
  setCurrent(paletteById(id));
  await hostApi.savePrefs({ theme: id });
}

function setCurrent(p: Palette): void {
  current = p;
  writeStr(CACHE_KEY, p.id);
  applyPalette(p);
  for (const fn of listeners) fn();
}

/** Boot: paint the cached palette at once, then the one saved in the environment. */
export async function initTheme(): Promise<void> {
  applyPalette(current);
  const prefs = await hostApi.prefs().catch(() => ({}) as Record<string, unknown>);
  if (prefs.theme && prefs.theme !== current.id) setCurrent(paletteById(prefs.theme));
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Calls `fn` with each new palette (for things outside React, like Monaco's theme). */
export function onPaletteChange(fn: (p: Palette) => void): () => void {
  const h = () => fn(current);
  listeners.add(h);
  return () => listeners.delete(h);
}

/** The active palette; re-renders when the user picks another one. */
export function usePalette(): Palette {
  return useSyncExternalStore(subscribe, currentPalette);
}

const hex = (c: string) => c.replace("#", "");

/** Monaco's theme for a palette (register it with monaco.editor.defineTheme). */
export function monacoTheme(p: Palette) {
  const c = p.colors;
  const s = p.syntax;
  return {
    base: (p.dark ? "vs-dark" : "vs") as "vs-dark" | "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: hex(s.comment), fontStyle: "italic" },
      { token: "keyword", foreground: hex(s.keyword) },
      { token: "string", foreground: hex(s.string) },
      { token: "number", foreground: hex(s.number) },
      { token: "type", foreground: hex(s.type) },
      { token: "function", foreground: hex(s.function) },
    ],
    colors: {
      "editor.background": c.bg,
      "editor.foreground": c.text,
      "editorLineNumber.foreground": c.line2,
      "editorLineNumber.activeForeground": c.text2,
      "editor.lineHighlightBackground": c.panel,
      "editor.selectionBackground": `${c.accent}33`,
      "editorCursor.foreground": c.accent,
      "editorIndentGuide.background1": c.line,
      "editorWidget.background": c.panel,
      "editorGutter.background": c.bg,
    },
  };
}

/** xterm.js theme for a palette. */
export function xtermTheme(p: Palette) {
  const c = p.colors;
  return {
    background: c.bg,
    foreground: c.text,
    cursor: c.accent,
    selectionBackground: `${c.accent}44`,
    black: c.panel2,
    brightBlack: c.text3,
    green: c.ok,
    red: c.bad,
    yellow: c.warn,
    blue: c.info,
    magenta: c.violet,
    cyan: p.syntax.function,
    white: c.text2,
    brightWhite: c.text,
  };
}

/** Colors for git graph lanes: a branch keeps its color all the way down. */
export function laneColors(p: Palette): string[] {
  const c = p.colors;
  return [c.accent, c.info, c.ok, c.violet, c.bad, c.warn, p.syntax.string, p.syntax.number];
}
