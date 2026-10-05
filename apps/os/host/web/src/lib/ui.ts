// Tiny helpers several components share.
import { useState } from "react";

/** A copy of `set` with `v` added, or removed if it was there — for checkbox lists and open/closed sets. */
export function toggled<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  next.has(v) ? next.delete(v) : next.add(v);
  return next;
}

/** Copy to the clipboard; `copied` stays true for 1.5 s so the button can say "✓". */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return { copied, copy };
}
