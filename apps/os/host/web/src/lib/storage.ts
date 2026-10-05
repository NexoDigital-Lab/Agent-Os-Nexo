// localStorage for per-browser conveniences (layout, open files, settings). Every access is guarded: private
// windows, previews or blocked site data make it throw, and the UI must work without it.
export function readStr(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStr(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function readLS<T>(key: string, fallback: T): T {
  const v = readStr(key);
  if (v === null) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export const writeLS = (key: string, value: unknown) => writeStr(key, JSON.stringify(value));
