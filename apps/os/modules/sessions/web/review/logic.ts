// Pure helpers for the batch diff review: comment shape, line-state check against the current file, and the message
// that goes to the chat composer. No DOM / React here so the test runner can import it (hence the relative import).
import { t } from "../../../../host/web/src/i18n.ts";
export type ReviewComment = {
  id: string;
  path: string;
  line: number;
  snippet: string; // the line's text when the comment was written
  text: string;
  at: number;
};

export type LineState = { moved: boolean; line: number };

/** Where a comment's line is now. `moved` = the text at `line` no longer matches the snippet; `line` is the new
 *  position when the snippet still exists exactly once, else the original one. */
export function resolveLine(c: Pick<ReviewComment, "line" | "snippet">, current: string[] | null): LineState {
  if (!current) return { moved: false, line: c.line }; // unknown (file not loaded): don't claim anything
  const snip = c.snippet.trim();
  if (!snip) return { moved: c.line > current.length, line: c.line };
  if (current[c.line - 1]?.trim() === snip) return { moved: false, line: c.line };
  const hits: number[] = [];
  current.forEach((l, i) => l.trim() === snip && hits.push(i + 1));
  return { moved: true, line: hits.length === 1 ? hits[0]! : c.line };
}

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + "…" : s);

export function composeReview(comments: ReviewComment[], states: Record<string, LineState> = {}): string {
  const items = comments.map((c, i) => {
    const st = states[c.id];
    const line = st?.line ?? c.line;
    const head = `${i + 1}. \`${c.path}:${line}\`${st?.moved ? ` ${t("(the line moved; it was {line})", { line: c.line })}` : ""}`;
    const quote = c.snippet.trim() ? `\n   > ${clip(c.snippet.trim())}` : "";
    return `${head}${quote}\n   ${c.text.trim().replace(/\n/g, "\n   ")}`;
  });
  return `${t("I reviewed your changes; fix this:")}\n\n${items.join("\n\n")}\n`;
}

/** Parses a unified diff into per-file new-side line numbers, so the chat panel can anchor comments. */
export function lineNumbers(diffLines: string[]): (number | null)[] {
  const out: (number | null)[] = [];
  let n = 0;
  for (const l of diffLines) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (h) { n = Number(h[1]); out.push(null); continue; }
    if (l.startsWith("diff --git") || /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |\\ )/.test(l)) { out.push(null); continue; }
    if (l.startsWith("-")) { out.push(null); continue; }
    out.push(n++);
  }
  return out;
}
