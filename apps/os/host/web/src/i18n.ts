// UI text: English is the key and the default; each module ships its other languages in its web entry
// (`messages: { es: { "New tab": "Nueva pestaña" } }`). Missing translations fall back to the English key,
// so server messages pass through `t()` too and get translated when a module lists them.
// A key may carry a context after "::" when one English word needs different translations in different places
// ("All::containers" → "Todos", "All" → "Todo"): English shows the part before it. The modules' dictionaries share
// one namespace, so test/messages.test.ts fails when two modules translate the same key differently.
export const LANGUAGES = { en: "English", es: "Español" } as const;
export type Language = keyof typeof LANGUAGES;

let current: Language = "en";
const dict: Record<string, Record<string, string>> = {};

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && v in LANGUAGES;
}

export function addMessages(messages: Partial<Record<Language, Record<string, string>>> | undefined): void {
  if (!messages) return;
  for (const [lang, entries] of Object.entries(messages)) Object.assign((dict[lang] ??= {}), entries);
}

export function setLanguage(lang: Language): void {
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export const language = (): Language => current;

/** Translates `key` and fills `{name}` placeholders: t("{n} tabs", { n: 3 }). */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = dict[current]?.[key] ?? key.replace(/::.*$/s, "");
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** The locale for dates and numbers in the current language. */
export const locale = (): string => (current === "es" ? "es" : "en");
