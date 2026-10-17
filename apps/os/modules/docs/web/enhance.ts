// Turns a document's sanitized HTML into what the reader shows: the title goes (the header shows it), headings get
// ids for the outline and for #links, "> **Tip:**" quotes become callouts, code blocks get their language and a
// copy button, and tables scroll on their own. Only static markup is added, after renderMarkdown sanitized the rest.

export interface OutlineEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export type CalloutKind = "tip" | "note" | "warning";

/** The word that opens a callout, in any language the docs use. */
const CALLOUTS: Record<string, CalloutKind> = {
  tip: "tip", consejo: "tip",
  note: "note", nota: "note",
  warning: "warning", important: "warning", atención: "warning", importante: "warning", cuidado: "warning",
};

/** The id GitHub gives a heading, so a #link works both there and here: NFC, lowercase, every character but letters
 * (accents kept), digits, the space, "-" and "_" dropped, each space a "-" ("Cómo empezar" → "cómo-empezar",
 * "A & B" → "a--b"; a tab or a non-breaking space is dropped, as on GitHub). */
export function headingId(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N} _-]/gu, "").replace(/ /g, "-");
}

/** Unique ids the way GitHub's slugger makes them: a repeat gets -1, -2…, skipping any id already taken. */
export function uniqueIds(texts: string[]): string[] {
  const taken = new Set<string>();
  return texts.map((text) => {
    const base = headingId(text) || "section";
    let id = base;
    for (let n = 1; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

export function enhance(html: string, copyLabel: string): { html: string; outline: OutlineEntry[] } {
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelector("h1")?.remove();

  const outline: OutlineEntry[] = [];
  const heads = [...root.querySelectorAll<HTMLHeadingElement>("h2, h3")];
  const ids = uniqueIds(heads.map((h) => h.textContent?.trim() ?? ""));
  heads.forEach((h, i) => {
    h.id = ids[i]!;
    outline.push({ id: h.id, text: h.textContent?.trim() ?? "", level: h.tagName === "H2" ? 2 : 3 });
  });

  for (const quote of root.querySelectorAll("blockquote")) {
    // Only a quote that opens with the bold word ("> **Tip:** …"), not one with a bold word somewhere inside.
    const first = quote.firstElementChild;
    const lead = first?.tagName === "P" && first.firstChild?.nodeName === "STRONG" ? first.firstChild : null;
    const kind = lead && CALLOUTS[lead.textContent!.replace(/[:：]\s*$/, "").trim().toLowerCase()];
    if (kind) quote.className = `docs-callout docs-${kind}`;
  }

  for (const pre of root.querySelectorAll("pre")) {
    const lang = /language-([\w-]+)/.exec(pre.querySelector("code")?.className ?? "")?.[1] ?? "";
    const box = document.createElement("div");
    box.className = "docs-code";
    const bar = document.createElement("div");
    bar.className = "docs-code-bar";
    const name = document.createElement("span");
    name.textContent = lang;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "docs-copy";
    copy.textContent = copyLabel;
    bar.append(name, copy);
    pre.replaceWith(box);
    box.append(bar, pre);
  }

  for (const table of root.querySelectorAll("table")) {
    const box = document.createElement("div");
    box.className = "docs-table";
    table.replaceWith(box);
    box.append(table);
  }

  return { html: root.innerHTML, outline };
}

/** Minutes to read a markdown body, at 200 words a minute; never less than one. */
export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));
}
