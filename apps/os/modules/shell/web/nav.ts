// How any module moves the user around or tells them something, without importing the shell's components.
const NAV = "os:navigate";
const NOTICE = "os:notice";

/** Switches the main area to a view (a rail entry id). */
export function goTo(view: string): void {
  window.dispatchEvent(new CustomEvent(NAV, { detail: view }));
}

/** A short message at the bottom of the screen (already translated). */
export function notify(text: string): void {
  window.dispatchEvent(new CustomEvent(NOTICE, { detail: text }));
}

export function onNavigate(fn: (view: string) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(NAV, h);
  return () => window.removeEventListener(NAV, h);
}

export function onNotice(fn: (text: string) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(NOTICE, h);
  return () => window.removeEventListener(NOTICE, h);
}
