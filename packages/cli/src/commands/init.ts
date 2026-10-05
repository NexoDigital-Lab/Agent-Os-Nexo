import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { basesDir, CONFIG_FILE, defaultRoot, expandHome } from "../core/paths.ts";
import { DEFAULT_FOLDERS, TOOLS, writeConfig, type EnvironmentConfig, type Tool } from "../core/config.ts";
import { copyFileSync } from "node:fs";
import { ensureDir, readJson, writeJson, writeText } from "../core/fsx.ts";
import { installFactory } from "../core/factory.ts";
import { buildLibraryIndex } from "../core/libindex.ts";
import { generateAdapters } from "../core/adapters.ts";
import { loadPermissions, PRESETS, type Preset } from "../core/permissions.ts";
import { createAsker } from "../core/prompt.ts";
import { gitConfig } from "../core/exec.ts";
import { nexoVersion } from "../core/version.ts";

export interface InitOptions {
  root?: string;
  yes?: boolean;
  tools?: string;
  preset?: string;
  name?: string;
  email?: string;
  language?: string;
}

const LIBRARY_DIRS = ["conventions", "dictionary", "commands", "memory", "skills", "agents", "hooks", "connections"];

export async function init(opts: InitOptions): Promise<string> {
  const asker = createAsker(Boolean(opts.yes));
  try {
    const root = resolve(expandHome(opts.root ?? (await asker.ask("Where should the environment live?", defaultRoot()))));
    if (existsSync(join(root, CONFIG_FILE))) {
      throw new Error(`${root} already holds a Nexo environment. Use \`nexo update\` instead.`);
    }
    const toolList = (opts.tools ?? (await asker.ask(`AIs to enable (${TOOLS.join(", ")})`, "claude")))
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

    const config: EnvironmentConfig = {
      nexo: { version: nexoVersion(), updatePolicy: "owner" },
      root,
      tools: Object.fromEntries(TOOLS.map((t) => [t, toolList.includes(t)])) as Record<Tool, boolean>,
      folders: { ...DEFAULT_FOLDERS },
      system: null,
    };

    ensureDir(root);
    writeConfig(root, config);
    copyFileSync(join(basesDir, "environment", "AGENTS.md"), join(root, "AGENTS.md"));

    const library = join(root, config.folders.library);
    for (const dir of LIBRARY_DIRS) ensureDir(join(library, dir));
    writeJson(join(library, "memory", "index.json"), []);
    writeText(
      join(library, "dictionary", "README.md"),
      "# dictionary\n\nOne file per term or name of your domain (clients, products, jargon). Agents read it when a term is unclear.",
    );
    const profile = readJson<Record<string, unknown>>(join(basesDir, "library", "profile.json"));
    writeJson(join(library, "profile.json"), { ...profile, identity: { name, email }, language });
    copyFileSync(join(basesDir, "permissions", `${preset}.json`), join(library, "permissions.json"));
    const factory = installFactory(library);
    buildLibraryIndex(library);

    writeJson(join(root, config.folders.blueprints, "index.json"), []);
    for (const sub of ["source", "versions", "data"]) ensureDir(join(root, config.folders.os, sub));
    ensureDir(join(root, config.folders.projects));
    ensureDir(join(root, config.folders.state));

    const adapters = generateAdapters(root, config, root, loadPermissions(join(library, "permissions.json")));

    return [
      `Nexo environment created at ${root}`,
      `  AIs: ${toolList.join(", ") || "none"} · permissions: ${preset} · factory items: ${factory.installed.length}`,
      `  Generated: ${adapters.join(", ") || "nothing (no AI needs extra files)"}`,
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
