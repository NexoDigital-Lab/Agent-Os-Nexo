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
import { nexoVersion } from "./core/version.ts";

const HELP = `nexo — install and maintain a Nexo agent environment

Usage: nexo <command> [options]

  init [path]                       Create an environment (default ~/environments)
        --yes  --tools claude,gemini  --preset strict|normal|relaxed
        --name <n>  --email <e>  --language <code>  --factory all|core|none
  update [--factory all|core|none]  Refresh factory items (owner: nexo) and AI files
  doctor [--quick] [--json]         Check the environment; reports, never changes
  analyze                           Record OS and toolchains (summary in the config)
  index                             Rebuild library/index.json
  clone <repo-url> [--ws <name>] [--name <part>]
                                    Clone into projects/ with context ready
  new <name> [--ws <name>]          Create an empty project
  connect [name] --command <cmd> [--args a,b] [--env K=V] [--remote]
              [--description <d>] [--tools claude,gemini]
                                    Add a connection; without a name, list them
  os [status|versions|next|use <x.y.z|latest>]
                                    agent-os builds

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
      quick: { type: "boolean" },
      json: { type: "boolean" },
      ws: { type: "string" },
      command: { type: "string" },
      args: { type: "string" },
      env: { type: "string", multiple: true },
      remote: { type: "boolean" },
      description: { type: "string" },
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
    case "os":
      return print(os(rest[0], rest[1], values));
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
