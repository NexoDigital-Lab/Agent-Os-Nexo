#!/usr/bin/env node
import { parseArgs } from "node:util";
import { init } from "./commands/init.ts";
import { update } from "./commands/update.ts";
import { index } from "./commands/index.ts";
import { doctor } from "./commands/doctor.ts";
import { analyze } from "./commands/analyze.ts";
import { clone, create } from "./commands/project.ts";
import { connect } from "./commands/connect.ts";
import { os } from "./commands/os.ts";
import { map } from "./commands/map.ts";
import { dict } from "./commands/dict.ts";
import { permissions } from "./commands/permissions.ts";
import { framework } from "./commands/framework.ts";
import { importTool } from "./commands/import.ts";
import { nexoVersion } from "./core/version.ts";

const HELP = `nexo — install and maintain a Nexo agent environment

Usage: nexo <command> [options]

  init [path]                       Create an environment (default ~/environments)
        --yes  --tools claude,gemini  --preset strict|normal|relaxed
        --name <n>  --email <e>  --language <code>  --factory all|core|none
        --os yes|no                 install agent-os-nexo now (later: nexo os install)
  update [--factory all|core|none]  Refresh factory items (owner: nexo) and AI files
  doctor [--quick] [--json]         Check the environment; reports, never changes
  analyze                           Record OS and toolchains (summary in the config)
  index                             Rebuild library/index.json
  permissions [show] [--project <id>]
                                    What agents may do alone (global, or a project's effective rules)
  permissions allow|ask|deny <files.read|files.edit|commands> <pattern> [--project <id>]
  permissions remove <area> <pattern> | set <default|os.<action>|connections.<n>.<action>> <decision>
                                    Change one rule, validated; refreshes every AI's files
  dict [list|show <term>|rm <term>] Your dictionary of concepts (library/dictionary/)
  dict add <term> --summary <s> [--alias a,b] [--body <text>] [--from <old name>]
                                    Save a concept (updates it if the term or an alias exists;
                                    --from renames)
  map [project] [--check]           Code map (symbols by file) in the project's context/map/
  clone <repo-url> [--ws <name>] [--name <part>]
                                    Clone into projects/ with context ready
  new <name> [--ws <name>]          Create an empty project
  import <claude|codex|gemini|opencode> [--apply] [--from <home>]
                                    Bring another AI's MCP servers and permissions into the library
                                    (shows the plan; --apply writes it; never weakens a rule)
  connect [name] --command <cmd> [--args a,b] [--env K=V] [--remote]
              [--description <d>] [--tools claude,gemini]
                                    Add a connection; without a name, list them
  framework [list]                  Third-party agent frameworks in frameworks/ (never touch permissions)
  framework add <npm:pkg@x.y.z|path:dir> [--name <n>] [--project <id>]
                                    Install (exact version, no install scripts) or reference one
  framework remove <name>           npm: delete its folder; path: only forget it
  framework enable|disable <name> [--project <id>]
  framework enable|disable <name> --hooks
                                    Approve / withdraw its hooks (off until you approve them)
  os [status|versions|next|use <x.y.z|latest>]
                                    agent-os-nexo builds
  os install [--from <dir>]         Copy agent-os-nexo into os/source, install its runtime, build 1.0.0
  os desktop [<tag>]                Download the desktop app installer for this OS (checksum-verified)
  os build [--notes <text>]         Build os/source into the next version
  os start|preview [--port <n>]     Run the active build (4780) / the source with hot reload (4781)
  os stop [--preview|--all]         Stop the app (default), the preview, or both
  os open [--preview]               Open the running app in the browser with its access link
  os check [--module <id>]          Check os/source against the module rules
  os update [--from <dir>]          Merge a new Nexo release into your version (--continue, --abort)

Global: --root <path> (or NEXO_ROOT) selects the environment; otherwise the nearest parent with
environment.config.json is used.`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      yes: { type: "boolean", short: "y" },
      tools: { type: "string" },
      preset: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      language: { type: "string" },
      factory: { type: "string" },
      os: { type: "string" },
      from: { type: "string" },
      notes: { type: "string" },
      port: { type: "string" },
      preview: { type: "boolean" },
      all: { type: "boolean" },
      module: { type: "string" },
      continue: { type: "boolean" },
      check: { type: "boolean" },
      abort: { type: "boolean" },
      quick: { type: "boolean" },
      json: { type: "boolean" },
      ws: { type: "string" },
      command: { type: "string" },
      args: { type: "string" },
      env: { type: "string", multiple: true },
      remote: { type: "boolean" },
      description: { type: "string" },
      summary: { type: "string" },
      alias: { type: "string" },
      body: { type: "string" },
      project: { type: "string" },
      apply: { type: "boolean" },
      hooks: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.version) return print(nexoVersion());
  if (values.help || !command) return print(HELP);

  switch (command) {
    case "init":
      return print(await init({ ...values, root: rest[0] ?? values.root }));
    case "update":
      return print(update(values));
    case "index":
      return print(index(values));
    case "doctor": {
      const { output, failed } = doctor(values);
      print(output);
      return failed ? 1 : 0;
    }
    case "analyze":
      return print(analyze(values));
    case "clone":
      if (!rest[0]) throw new Error("Usage: nexo clone <repo-url> [--ws <name>] [--name <part>]");
      return print(clone(rest[0], values));
    case "new":
      if (!rest[0]) throw new Error("Usage: nexo new <name> [--ws <name>]");
      return print(create(rest[0], values));
    case "connect":
      return print(connect(rest[0], values));
    case "map":
      return print(map(rest[0], values));
    case "dict":
      return print(dict(rest[0], rest.slice(1), values));
    case "import":
      return print(importTool(rest[0], values));
    case "permissions":
      return print(permissions(rest[0], rest.slice(1), values));
    case "framework":
      return print(framework(rest[0], rest.slice(1), values));
    case "os":
      return print(await os(rest[0], rest[1], values));
    default:
      throw new Error(`Unknown command "${command}". Run \`nexo --help\`.`);
  }
}

function print(text: string): number {
  console.log(text);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`nexo: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
