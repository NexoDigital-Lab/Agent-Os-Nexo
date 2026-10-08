// The palettes a user can pick. Nexo (the default) comes from the Nexo Digital website; the rest keep its
// structure (dark grounds, one accent, a secondary hue) and every text pair passes WCAG AA (≥ 4.5:1,
// checked in test/palettes.test.ts).

export interface Palette {
  id: string;
  name: string;
  description: string;
  dark: boolean;
  fonts: { sans: string; display: string };
  colors: {
    bg: string; bg2: string; panel: string; panel2: string; line: string; line2: string;
    text: string; text2: string; text3: string;
    accent: string; accentInk: string; accentText: string;
    ok: string; bad: string; info: string; warn: string; violet: string;
    add: string; del: string;
  };
  syntax: { keyword: string; function: string; string: string; number: string; comment: string; type: string };
  brand: string;
}

const INTER = '"Inter Variable", "Inter", system-ui, sans-serif';
const OUTFIT = '"Outfit", "Inter Variable", system-ui, sans-serif';
const PLEX = '"IBM Plex Sans", system-ui, sans-serif';

export const PALETTES: Palette[] = [
  {
    id: "nexo", name: "Nexo", description: "Nexo's identity: violet, cyan and magenta on a near-black blue ground.", dark: true,
    fonts: { sans: INTER, display: OUTFIT },
    colors: { bg: "#0a0a0f", bg2: "#0f0f1a", panel: "#12121f", panel2: "#1a1a2e", line: "#24203a", line2: "#352d55", text: "#f0f0ff", text2: "#babac2", text3: "#9a9ab0",
      accent: "#a855f7", accentInk: "#0a0a0f", accentText: "#c084fc", ok: "#4ade80", bad: "#ff2d78", info: "#00f5ff", warn: "#fbbf24", violet: "#818cf8", add: "#0d2a1c", del: "#2e0e1d" },
    syntax: { keyword: "#c084fc", function: "#00f5ff", string: "#86efac", number: "#ff7aa8", comment: "#8a8aa3", type: "#818cf8" },
    brand: "linear-gradient(135deg, #00f5ff, #a855f7, #ff2d78)",
  },
  {
    id: "noche", name: "Night", description: "The palette of the desktop app's splash screen, based on Tokyo Night: blue and pink on a night-blue ground.", dark: true,
    fonts: { sans: INTER, display: OUTFIT },
    colors: { bg: "#111318", bg2: "#16161e", panel: "#1a1b26", panel2: "#24283b", line: "#292e42", line2: "#3b4261", text: "#c9ced8", text2: "#a9b1d6", text3: "#8b93be",
      accent: "#7aa2f7", accentInk: "#111318", accentText: "#7aa2f7", ok: "#9ece6a", bad: "#f7768e", info: "#7dcfff", warn: "#e0af68", violet: "#bb9af7", add: "#1d2b1f", del: "#33202a" },
    syntax: { keyword: "#bb9af7", function: "#7aa2f7", string: "#9ece6a", number: "#ff9e64", comment: "#7a83b0", type: "#2ac3de" },
    brand: "linear-gradient(135deg, #7aa2f7, #bb9af7, #f7768e)",
  },
  {
    id: "ambar", name: "Amber", description: "The warm palette of the first agent-os-nexo: warm graphite with an amber accent.", dark: true,
    fonts: { sans: PLEX, display: PLEX },
    colors: { bg: "#0e0d0c", bg2: "#151412", panel: "#1a1917", panel2: "#211f1c", line: "#2c2a26", line2: "#3a3732", text: "#ece6dc", text2: "#b3aca1", text3: "#958f85",
      accent: "#f0a53a", accentInk: "#1a1206", accentText: "#f0a53a", ok: "#7fc98f", bad: "#ec7a6a", info: "#7fb4e8", warn: "#e8c46a", violet: "#b79cf0", add: "#16301d", del: "#3a1c19" },
    syntax: { keyword: "#f0a53a", function: "#7fb4e8", string: "#a8d8a0", number: "#b79cf0", comment: "#8a847a", type: "#7fb4e8" },
    brand: "linear-gradient(135deg, #f0a53a, #ec7a6a)",
  },
  {
    id: "aurora", name: "Aurora", description: "Teal accent with Nexo's violet as the second hue, on a very dark green ground. Calmer for long sessions.", dark: true,
    fonts: { sans: INTER, display: OUTFIT },
    colors: { bg: "#07100f", bg2: "#0b1716", panel: "#0f1d1c", panel2: "#152826", line: "#1f3532", line2: "#2c4a46", text: "#e8f6f3", text2: "#a9c4bf", text3: "#86a39e",
      accent: "#2dd4bf", accentInk: "#04201c", accentText: "#5eead4", ok: "#86efac", bad: "#fb7185", info: "#a78bfa", warn: "#fcd34d", violet: "#c4b5fd", add: "#0f2e22", del: "#33141b" },
    syntax: { keyword: "#5eead4", function: "#a78bfa", string: "#bef264", number: "#fda4af", comment: "#7d9a95", type: "#c4b5fd" },
    brand: "linear-gradient(135deg, #2dd4bf, #00f5ff, #a855f7)",
  },
  {
    id: "oceano", name: "Ocean", description: "Nexo's family with cyan as the accent and violet as the second hue, on navy.", dark: true,
    fonts: { sans: INTER, display: OUTFIT },
    colors: { bg: "#070b14", bg2: "#0b1220", panel: "#0f1828", panel2: "#152135", line: "#1f2d45", line2: "#2c3e5c", text: "#eaf2ff", text2: "#b0bfd6", text3: "#8c9bb4",
      accent: "#22d3ee", accentInk: "#041a20", accentText: "#67e8f9", ok: "#4ade80", bad: "#f87171", info: "#a5b4fc", warn: "#fbbf24", violet: "#c084fc", add: "#0c2a24", del: "#33151c" },
    syntax: { keyword: "#67e8f9", function: "#c084fc", string: "#86efac", number: "#fda4af", comment: "#7f8eaa", type: "#a5b4fc" },
    brand: "linear-gradient(135deg, #22d3ee, #6366f1, #a855f7)",
  },
  {
    id: "synthwave", name: "Synthwave", description: "Nexo's magenta becomes the accent, with cyan for information. The most intense option.", dark: true,
    fonts: { sans: INTER, display: OUTFIT },
    colors: { bg: "#0d0710", bg2: "#140a18", panel: "#1a0f1f", panel2: "#24142b", line: "#33203b", line2: "#47304f", text: "#fbeefc", text2: "#cdb3d2", text3: "#a98daf",
      accent: "#ff4f9a", accentInk: "#1a0610", accentText: "#ff8ab8", ok: "#a3e635", bad: "#ff7a59", info: "#22d3ee", warn: "#fdba74", violet: "#c084fc", add: "#16290f", del: "#3a1220" },
    syntax: { keyword: "#ff8ab8", function: "#22d3ee", string: "#bef264", number: "#fdba74", comment: "#9a7fa0", type: "#c084fc" },
    brand: "linear-gradient(135deg, #ff2d78, #ff7a59, #fbbf24)",
  },
  {
    id: "nexo-light", name: "Nexo Light", description: "Nexo for daylight: white grounds and a deeper violet that holds its contrast.", dark: false,
    fonts: { sans: INTER, display: OUTFIT },
    colors: { bg: "#f6f5fb", bg2: "#eeecf7", panel: "#ffffff", panel2: "#f3f1fa", line: "#e2def0", line2: "#cbc4e0", text: "#15121f", text2: "#4b4560", text3: "#635d78",
      accent: "#7c3aed", accentInk: "#ffffff", accentText: "#6d28d9", ok: "#15803d", bad: "#be123c", info: "#0e7490", warn: "#b45309", violet: "#4f46e5", add: "#dcfce7", del: "#ffe4e6" },
    syntax: { keyword: "#7c3aed", function: "#0e7490", string: "#15803d", number: "#be185d", comment: "#6b6580", type: "#4f46e5" },
    brand: "linear-gradient(135deg, #0891b2, #7c3aed, #db2777)",
  },
  {
    id: "high-contrast", name: "High contrast", description: "Pure black, white text and light accents. Every text pair passes AAA.", dark: true,
    fonts: { sans: INTER, display: OUTFIT },
    colors: { bg: "#000000", bg2: "#050508", panel: "#0a0a10", panel2: "#14141c", line: "#3a3a4a", line2: "#5a5a70", text: "#ffffff", text2: "#e0e0ea", text3: "#c4c4d4",
      accent: "#d8b4fe", accentInk: "#000000", accentText: "#e9d5ff", ok: "#86efac", bad: "#ff8fab", info: "#67e8f9", warn: "#fde047", violet: "#a5b4fc", add: "#0f3320", del: "#3d0f1c" },
    syntax: { keyword: "#e9d5ff", function: "#67e8f9", string: "#86efac", number: "#ffb3c7", comment: "#c4c4d4", type: "#a5b4fc" },
    brand: "linear-gradient(135deg, #67e8f9, #d8b4fe, #ff8fab)",
  },
];

export const DEFAULT_PALETTE = "nexo";

export const paletteById = (id: unknown): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0]!;

/** WCAG 2.1 contrast ratio between two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The text/background pairs every palette must keep readable. */
export const CONTRAST_PAIRS: Array<[label: string, fg: keyof Palette["colors"], bg: keyof Palette["colors"]]> = [
  ["text on background", "text", "bg"],
  ["secondary text on panel", "text2", "panel"],
  ["muted text on raised panel", "text3", "panel2"],
  ["accent text on panel", "accentText", "panel"],
  ["primary button", "accentInk", "accent"],
  ["success", "ok", "panel"],
  ["error", "bad", "panel"],
  ["info", "info", "panel"],
  ["warning", "warn", "panel"],
];
