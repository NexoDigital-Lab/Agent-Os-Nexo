export type FrontmatterValue = string | string[];

export interface Parsed {
  data: Record<string, FrontmatterValue>;
  body: string;
  hasFrontmatter: boolean;
}

/** Parses the small YAML subset used in Nexo files: `key: value` and `key: [a, b]`. */
export function parseFrontmatter(text: string): Parsed {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text, hasFrontmatter: false };
  const data: Record<string, FrontmatterValue> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] as string;
    const raw = (kv[2] ?? "").trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      data[key] = raw
        .slice(1, -1)
        .split(",")
        .map((item) => unquote(item.trim()))
        .filter(Boolean);
    } else {
      data[key] = unquote(raw);
    }
  }
  return { data, body: text.slice(match[0].length), hasFrontmatter: true };
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}
