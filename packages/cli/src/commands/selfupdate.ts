// nexo self-update: upgrade the CLI. From npm, with the package manager that installed it; for developers, from one
// commit of a Nexo checkout, pointing the launcher at it (core/selfupdate.ts). Either way the memory connection,
// which names the nexo the AIs start, is rewritten for the new one.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { folder, readConfig } from "../core/config.ts";
import { binaryPath, engramPaths, memoryConnectionFile, readPin } from "../core/engram.ts";
import { findRoot, expandHome } from "../core/paths.ts";
import { refreshAll } from "../core/projects.ts";
import { defaultLauncher, readCliState, selfUpdate, type Git } from "../core/selfupdate.ts";
import { CLI_PACKAGE, defaultRunner, installKind, upgradeArgs, type Install, type Runner } from "../core/upgrade.ts";

export interface SelfUpdateCommandOptions {
  root?: string;
  from?: string;
  ref?: string;
  bin?: string;
}

export interface SelfUpdateDeps {
  git?: Git;
  probe?: (entry: string) => string;
  install?: Install;
  run?: Runner;
}

const USAGE = "Usage: nexo self-update [--from <nexo checkout>] [--ref main|<tag>] [--bin <launcher>] (the checkout is remembered after the first time)";

export function selfUpdateCommand(opts: SelfUpdateCommandOptions, deps: SelfUpdateDeps = {}): string {
  const root = findRoot(opts.root);
  const last = readCliState(root);
  const install = deps.install ?? installKind();
  // The nexo running now decides: one installed by a package manager upgrades that way, even if a checkout was used
  // before; --from always means the checkout.
  const source = opts.from ? expandHome(opts.from) : install.kind === "global" ? undefined : last?.source;
  const lines = source ? fromCheckout(root, source, opts, last, deps) : fromPackage(install, deps);
  // The AIs start the memory connection by the nexo it names: refreshing rewrites it for the one installed now.
  const config = readConfig(root);
  if (config.memory === "engram" && existsSync(memoryConnectionFile(folder(root, config, "library")))) {
    refreshAll(root, config);
    lines.push("Memory connection refreshed for the new nexo.");
  }
  return lines.join("\n");
}

function fromCheckout(root: string, source: string, opts: SelfUpdateCommandOptions, last: ReturnType<typeof readCliState>, deps: SelfUpdateDeps): string[] {
  const ref = opts.ref ?? last?.ref ?? "main";
  const launcher = opts.bin ? expandHome(opts.bin) : last?.launcher ?? defaultLauncher();
  const { state, changed, files } = selfUpdate({ root, source, ref, launcher, git: deps.git, probe: deps.probe });
  const short = state.commit.slice(0, 7);
  const what = changed ? `Installed nexo ${state.version} from ${ref} (${short})${files ? `, ${files} files` : ""}.` : `Already on ${ref} (${short}); launcher refreshed.`;
  const lines = [what, `  copy: ${state.dir}`, `  launcher: ${state.launcher}`, `Only committed files of ${ref} were copied; the checkout itself is never run.`];
  // The new copy may pin a newer Engram: memory keeps running on the installed one until it is updated.
  const config = readConfig(root);
  const pinFile = join(state.dir, "nexo_bases", "engram.json");
  if (config.memory === "engram" && existsSync(pinFile)) {
    const pinned = readPin(pinFile).version;
    if (!existsSync(binaryPath(engramPaths(root, config), pinned))) lines.push(`This version pins Engram ${pinned}: run \`nexo memory update\` to install it.`);
  }
  return lines;
}

/** Installed from npm (or pnpm, yarn, bun): the same manager installs the latest version over it. */
function fromPackage(install: Install, deps: SelfUpdateDeps): string[] {
  if (install.kind === "npx") return [`This nexo runs through npx, which fetches the latest version each time. To install it: npm install --global ${CLI_PACKAGE}`];
  if (install.kind === "local") return [`This nexo is a dependency of a project: update ${CLI_PACKAGE} in its package.json (npm install ${CLI_PACKAGE}@latest).`];
  if (install.kind !== "global") throw new Error(USAGE);
  const args = upgradeArgs(install.manager);
  const code = (deps.run ?? defaultRunner)(install.manager, args);
  if (code !== 0) throw new Error(`${install.manager} ${args.join(" ")} failed (exit ${code}).`);
  return [`Upgraded with ${install.manager} ${args.join(" ")}.`];
}
