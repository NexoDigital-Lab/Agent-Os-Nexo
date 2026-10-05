import { existsSync } from "node:fs";
import { extname } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import { readJson, readText } from "./fsx.ts";

/** Reads `owner` from a markdown frontmatter or a JSON file; null when absent or unreadable. */
export function ownerOf(file: string): string | null {
  if (!existsSync(file)) return null;
  try {
    if (extname(file) === ".json") {
      const owner = readJson<{ owner?: unknown }>(file).owner;
      return typeof owner === "string" ? owner : null;
    }
    const owner = parseFrontmatter(readText(file)).data.owner;
    return typeof owner === "string" ? owner : null;
  } catch {
    return null;
  }
}
