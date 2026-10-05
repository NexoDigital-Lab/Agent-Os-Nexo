// The ONE place Markdown becomes HTML for dangerouslySetInnerHTML. Always sanitized: no images (exfiltration),
// no styles/forms/embeds, links forced to open outside with noopener, and only http(s)/mailto/relative hrefs.
import DOMPurify from "dompurify";
import { marked } from "marked";

const FORBID_TAGS = ["style", "img", "iframe", "form", "input", "object", "embed"];

/** Same-origin or relative (no scheme, no protocol-relative host). */
function sameOrigin(u: string): boolean {
  try {
    return new URL(u, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function safeHref(h: string): boolean {
  const v = h.trim();
  if (v.startsWith("#")) return true;
  try {
    const url = new URL(v, "http://relative.invalid/");
    if (url.origin === "http://relative.invalid" && !v.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(v)) return true;
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function makePurifier(allowImg: boolean) {
  const p = DOMPurify(window);
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      if (href !== null && !safeHref(href)) node.removeAttribute("href");
      if (node.hasAttribute("href") && !node.getAttribute("href")!.startsWith("#")) {
        node.setAttribute("rel", "noopener noreferrer");
        node.setAttribute("target", "_blank");
      }
    } else if (node.tagName === "IMG") {
      const src = node.getAttribute("src");
      if (!allowImg || !src || !sameOrigin(src)) node.remove();
      else (node.removeAttribute("srcset"), node.setAttribute("loading", "lazy"));
    }
  });
  return {
    run: (html: string) =>
      p.sanitize(html, { FORBID_TAGS: allowImg ? FORBID_TAGS.filter((t) => t !== "img") : FORBID_TAGS, FORBID_ATTR: ["style"] }) as string,
  };
}

let strict: ReturnType<typeof makePurifier> | null = null;
let local: ReturnType<typeof makePurifier> | null = null;

/** Markdown -> sanitized HTML. `allowLocalImages` is only for previewing the user's own local files. */
export function renderMarkdown(src: string, opts?: { allowLocalImages?: boolean }): string {
  const html = marked.parse(src) as string;
  if (opts?.allowLocalImages) return (local ??= makePurifier(true)).run(html);
  return (strict ??= makePurifier(false)).run(html);
}
