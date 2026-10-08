// Living next to other frameworks: the files each AI reads (.mcp.json, .claude/settings.json hooks, opencode.json,
// .gemini/settings.json, .claude/CLAUDE.md) are shared with whatever else the user installed. Nexo replaces only the
// entries it wrote last time — recorded in .state/nexo/generated.json — and keeps everything else. Permissions are the
// exception: they always come from permissions.json alone (a framework never changes them).
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { readJson, writeJson } from "./fsx.ts";

/** What Nexo wrote into one file: the keys of maps it owns (mcp servers) and the entries of lists it owns (hooks). */
export interface Written {
  keys?: Record<string, string[]>;
  items?: Record<string, string[]>;
}

type Obj = Record<string, unknown>;
export const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The record of what Nexo generated, per file (relative to the environment root). */
export class Ledger {
  private readonly root: string;
  private readonly file: string;
  private readonly data: Record<string, Written>;
  constructor(root: string, stateDir: string) {
    this.root = root;
    this.file = join(stateDir, "nexo", "generated.json");
    this.data = existsSync(this.file) ? asObj(readJson<unknown>(this.file)) as Record<string, Written> : {};
  }
  private key(path: string): string {
    return relative(this.root, path).replace(/\\/g, "/");
  }
  get(path: string): Written | undefined {
    return this.data[this.key(path)];
  }
  set(path: string, written: Written): void {
    this.data[this.key(path)] = written;
  }
  save(): void {
    writeJson(this.file, this.data);
  }
}

/**
 * A map Nexo shares with others (mcpServers): Nexo's entries replace the ones it wrote before; any other key stays.
 * Without a record (first run), a key whose value equals Nexo's is taken as Nexo's; the rest is kept as foreign.
 */
export function mergeKeys(current: unknown, ours: Obj, before: string[] | undefined): { value: Obj; keys: string[] } {
  const value: Obj = {};
  for (const [k, v] of Object.entries(asObj(current))) {
    const wasOurs = before ? before.includes(k) : k in ours && same(v, ours[k]);
    if (!wasOurs && !(k in ours)) value[k] = v;
  }
  Object.assign(value, ours);
  return { value, keys: Object.keys(ours) };
}

/** A list Nexo shares with others (the hooks of one event): foreign entries first, then Nexo's, without duplicates. */
export function mergeItems(current: unknown, ours: unknown[], before: string[] | undefined): { value: unknown[]; items: string[] } {
  const mine = ours.map((x) => JSON.stringify(x));
  const kept = (Array.isArray(current) ? current : []).filter((x) => {
    const s = JSON.stringify(x);
    return !(before ?? []).includes(s) && !mine.includes(s);
  });
  return { value: [...kept, ...ours], items: mine };
}

/** Merges per-event hook lists (Claude Code's `hooks` setting); events nobody uses any more disappear. */
export function mergeHooks(current: unknown, ours: Record<string, unknown[]>, before: Record<string, string[]> | undefined) {
  const cur = asObj(current);
  const value: Obj = {};
  const items: Record<string, string[]> = {};
  for (const event of new Set([...Object.keys(cur), ...Object.keys(ours)])) {
    const merged = mergeItems(cur[event], ours[event] ?? [], before?.[event]);
    if (merged.value.length) value[event] = merged.value;
    if (merged.items.length) items[event] = merged.items;
  }
  return { value, items };
}

/**
 * CLAUDE.md that points at AGENTS.md: Nexo's line first, then the lines `extra` that Nexo adds for frameworks (those it
 * added before, `before`, are replaced); lines another framework or the user added stay after them.
 */
export function withAgentsPointer(current: string | null, pointer = "@../AGENTS.md", extra: string[] = [], before: string[] = []): string {
  const mine = new Set([pointer, ...extra, ...before]);
  const rest = (current ?? "").split(/\r?\n/).filter((l) => !mine.has(l.trim()));
  while (rest.length && !rest[0]?.trim()) rest.shift();
  const head = [pointer, ...extra].join("\n");
  return rest.length ? `${head}\n${rest.join("\n").replace(/\s+$/, "")}\n` : head;
}
