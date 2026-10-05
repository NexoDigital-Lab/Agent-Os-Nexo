// Builds one version of agent-os into --out: the web UI (Vite → dist/web) plus the server-side code it runs with
// (host/server, src/, each module's module.json + server/), and build.json. No web sources, no tests. Dependencies
// are not copied: the CLI links node_modules to the environment's shared runtime (os/runtime/<hash>).
//   node scripts/build.ts --out <dir> --version <x.y.z> [--notes <text>] [--runtime <hash>] [--skip-web]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** What a build carries from the source, relative to it. */
export const SERVER_PARTS = ["host/server", "src", "schema", "package.json"];

/** True for what a build leaves out of modules/: web sources, tests, dependencies. */
export function skipInModules(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  return parts.some((p) => p === "web" || p === "test" || p === "node_modules") || /\.test\.ts$/.test(rel);
}

export function copyServer(from: string, out: string): void {
  for (const part of SERVER_PARTS) {
    const src = join(from, part);
    if (existsSync(src)) cpSync(src, join(out, part), { recursive: true, filter: (p) => !/\.test\.ts$/.test(p) });
  }
  const modules = join(from, "modules");
  cpSync(modules, join(out, "modules"), { recursive: true, filter: (p) => p === modules || !skipInModules(relative(modules, p)) });
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      version: { type: "string" },
      notes: { type: "string", default: "" },
      runtime: { type: "string", default: "" },
      "skip-web": { type: "boolean", default: false },
    },
  });
  if (!values.out || !values.version) throw new Error("Usage: node scripts/build.ts --out <dir> --version <x.y.z> [--notes <text>]");
  const out = resolve(values.out);
  if (out === appDir || out.startsWith(appDir + sep)) throw new Error("--out must be outside the source folder");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  if (!values["skip-web"]) {
    const { build } = await import("vite"); // a dev dependency, present in the shared runtime
    await build({ configFile: join(appDir, "vite.config.ts"), logLevel: "warn", build: { outDir: join(out, "dist", "web"), emptyOutDir: true } });
  }
  copyServer(appDir, out);
  const build = { version: values.version, builtAt: new Date().toISOString(), notes: values.notes, runtime: values.runtime };
  writeFileSync(join(out, "build.json"), JSON.stringify(build, null, 2) + "\n");
  const modules = readdirSync(join(out, "modules")).length;
  console.log(`agent-os ${values.version} built (${modules} modules${values["skip-web"] ? ", no web UI" : ""})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(`build: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
