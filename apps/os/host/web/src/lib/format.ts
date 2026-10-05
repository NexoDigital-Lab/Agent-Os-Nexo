// Display formatting shared by every view: money, token counts, model names, relative times.
import { locale, t } from "../i18n";

export const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);

export const ktok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export const shortModel = (m: string) => m.replace(/^claude-/, "").replace(/-\d{8}$/, "");

/** "5 min ago" / "3 d ago"; past a month, the date. Takes an ISO string or epoch ms. */
export function ago(when: string | number | null | undefined) {
  if (when === null || when === undefined || when === "") return "";
  const ms = typeof when === "number" ? when : Date.parse(when);
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return t("now");
  if (s < 3600) return t("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t("{n} d ago", { n: Math.floor(s / 86400) });
  return new Date(ms).toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "2-digit" });
}
