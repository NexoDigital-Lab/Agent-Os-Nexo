import { execFileSync } from "node:child_process";
import { findRoot } from "../core/paths.ts";
import { readConfig } from "../core/config.ts";
import { ensureDir } from "../core/fsx.ts";
import { createProject, repoName } from "../core/projects.ts";
import { writeIndex } from "./map.ts";

function summary(kind: string, dir: string, root: string): string {
  const rel = dir.slice(root.length + 1);
  return [
    `${kind} ${rel}`,
    `  ${rel}/code/      the repository`,
    `  ${rel}/context/   everything for the AI (start at context/README.md; the code index is context/map/)`,
    `  ${rel}/AGENTS.md  project rules — run the nexo-onboard skill to fill it`,
  ].join("\n");
}

export function clone(url: string, opts: { root?: string; ws?: string; name?: string }): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const name = opts.name ?? repoName(url);
  const paths = createProject(root, config, { name, ws: opts.ws }, (code) => {
    execFileSync("git", ["clone", url, code], { stdio: ["ignore", "ignore", "pipe"] });
  });
  // Index it right away (context/map/), so the first agent session reads the overview instead of exploring.
  let indexed: string;
  try {
    indexed = `  ${writeIndex(paths.dir, root)}`;
  } catch (e) {
    indexed = `  Not indexed (${(e as Error).message}): run \`nexo map\` later.`;
  }
  return `${summary("Cloned into", paths.dir, root)}\n${indexed}`;
}

export function create(name: string, opts: { root?: string; ws?: string }): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const paths = createProject(root, config, { name, ws: opts.ws }, (code) => {
    ensureDir(code);
    execFileSync("git", ["init", "-q", code]);
  });
  return summary("Created", paths.dir, root);
}
