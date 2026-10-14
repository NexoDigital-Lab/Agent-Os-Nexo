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

/** "Personalize it" → "personalize-it", "Cómo empezar" → "como-empezar": the id GitHub would give the heading. */
export function headingId(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function enhance(html: string, copyLabel: string): { html: string; outline: OutlineEntry[] } {
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelector("h1")?.remove();

  const outline: OutlineEntry[] = [];
  const used = new Map<string, number>();
  for (const h of root.querySelectorAll<HTMLHeadingElement>("h2, h3")) {
    const text = h.textContent?.trim() ?? "";
    const base = headingId(text) || "section";
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
    outline.push({ id: h.id, text, level: h.tagName === "H2" ? 2 : 3 });
  }

  for (const quote of root.querySelectorAll("blockquote")) {
    const lead = quote.querySelector("p > strong:first-child");
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
