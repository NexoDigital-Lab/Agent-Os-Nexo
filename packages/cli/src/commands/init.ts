import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { basesDir, CONFIG_FILE, defaultRoot, expandHome } from "../core/paths.ts";
import { onPath } from "../core/exec.ts";
import { DEFAULT_FOLDERS, TOOLS, writeConfig, type EnvironmentConfig, type Tool } from "../core/config.ts";
import { copyFileSync } from "node:fs";
import { ensureDir, readJson, writeJson, writeText } from "../core/fsx.ts";
import { FACTORY_SETS, installFactory, isFactorySet } from "../core/factory.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { generateAdapters } from "../core/adapters.ts";
import { loadPermissions, PRESETS, type Preset } from "../core/permissions.ts";
import { createAsker } from "../core/prompt.ts";
import { gitConfig } from "../core/exec.ts";
import { nexoVersion } from "../core/version.ts";
import { os, type OsOptions } from "./os.ts";
import type { Runner } from "../core/osruntime.ts";

export interface InitOptions {
  root?: string;
  yes?: boolean;
  tools?: string;
  preset?: string;
  name?: string;
  email?: string;
  language?: string;
  factory?: string;
  /** "yes" installs agent-os-nexo right away (`nexo os install`); it can always be added later. */
  os?: string;
  /** Where to copy agent-os-nexo from instead of npm (a local checkout). */
  from?: string;
}

const LIBRARY_DIRS = ["conventions", "dictionary", "commands", "memory", "skills", "agents", "hooks", "connections"];

export async function init(opts: InitOptions, run?: Runner): Promise<string> {
  const asker = createAsker(Boolean(opts.yes));
  try {
    const root = resolve(expandHome(opts.root ?? (await asker.ask("Where should the environment live?", defaultRoot()))));
    if (existsSync(join(root, CONFIG_FILE))) {
      throw new Error(`${root} already holds a Nexo environment. Use \`nexo update\` instead.`);
    }
    // Offer the AIs this machine already has (not everyone uses Claude); Claude when none is found.
    const installed = TOOLS.filter((t) => onPath(t));
    const toolList = (opts.tools ?? (await asker.ask(`AIs to enable (${TOOLS.join(", ")})`, installed.join(",") || "claude")))
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tool of toolList) {
      if (!TOOLS.includes(tool as Tool)) throw new Error(`Unknown AI "${tool}". Choose from: ${TOOLS.join(", ")}.`);
    }
    const preset = (opts.preset ?? (await asker.ask(`Permission preset (${PRESETS.join(", ")})`, "normal"))) as Preset;
    if (!PRESETS.includes(preset)) throw new Error(`Unknown preset "${preset}". Choose from: ${PRESETS.join(", ")}.`);
    const name = opts.name ?? (await asker.ask("Your name (for commits)", gitConfig("user.name")));
    const email = opts.email ?? (await asker.ask("Your email (for commits)", gitConfig("user.email")));
    const language = opts.language ?? (await asker.ask("Language agents should answer in", "en"));
    const factorySet = opts.factory ?? (await asker.ask(`Default skills, agents, hooks and commands (${FACTORY_SETS.join(", ")})`, "all"));
    if (!isFactorySet(factorySet)) throw new Error(`Unknown factory set "${factorySet}". Choose from: ${FACTORY_SETS.join(", ")}.`);
    const withOs = (opts.os ?? (await asker.ask("Install agent-os-nexo, the local app (yes, no)", "no"))).toLowerCase();
    if (withOs !== "yes" && withOs !== "no") throw new Error(`Answer yes or no for agent-os-nexo, not "${withOs}".`);

    const config: EnvironmentConfig = {
      nexo: { version: nexoVersion(), updatePolicy: "owner" },
      root,
      tools: Object.fromEntries(TOOLS.map((t) => [t, toolList.includes(t)])) as Record<Tool, boolean>,
      folders: { ...DEFAULT_FOLDERS },
      system: null,
      factory: factorySet,
    };

    ensureDir(root);
    writeConfig(root, config);
    copyFileSync(join(basesDir, "environment", "AGENTS.md"), join(root, "AGENTS.md"));

    const library = join(root, config.folders.library);
    for (const dir of LIBRARY_DIRS) ensureDir(join(library, dir));
    writeJson(join(library, "memory", "index.json"), []);
    writeText(
      join(library, "dictionary", "README.md"),
      "# dictionary\n\nYour concepts, one file per term (clients, products, jargon), so no agent asks twice. Save one with\n`nexo dict add <term> --summary <s>`, or tell an agent \"guardá este concepto\". Agents see every term in\nlibrary/index.json and open the file when they need the details.",
    );
    const profile = readJson<Record<string, unknown>>(join(basesDir, "library", "profile.json"));
    writeJson(join(library, "profile.json"), { ...profile, identity: { name, email }, language });
    copyFileSync(join(basesDir, "permissions", `${preset}.json`), join(library, "permissions.json"));
    const factory = installFactory(library, factorySet);
    buildLibraryIndex(library);

    writeJson(join(root, config.folders.blueprints, "index.json"), []);
    for (const sub of ["source", "versions", "data"]) ensureDir(join(root, config.folders.os, sub));
    ensureDir(join(root, config.folders.projects));
    ensureDir(join(root, config.folders.state));
    ensureDir(join(root, config.folders.frameworks));

    const adapters = generateAdapters(root, config, root, loadPermissions(join(library, "permissions.json")));
    const osLine =
      withOs === "yes"
        ? (await os("install", undefined, { root, from: opts.from } satisfies OsOptions, run)).split("\n")[0]
        : "agent-os-nexo not installed (add it any time with `nexo os install`).";

    return [
      `Nexo environment created at ${root}`,
      `  AIs: ${toolList.join(", ") || "none"} · permissions: ${preset} · factory: ${factorySet} (${factory.installed.length} items)`,
      `  Generated: ${adapters.join(", ") || "nothing (no AI needs extra files)"}`,
      `  ${osLine}`,
      "",
      "Next:",
      `  cd ${root}`,
      "  nexo analyze            # record your OS and toolchains",
      "  nexo clone <repo-url>   # bring in your first project",
    ].join("\n");
  } finally {
    asker.close();
  }
}
