// agent-os-nexo server: discovers the modules, mounts the active ones, and serves the web UI — one process,
// one port, localhost only. `--dev` serves the UI through Vite (used for the preview of os/source).
// Everything but reading the command line and listening lives in app.ts.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createAgentOsNexo } from "./app.ts";
import { loadEnv } from "./env.ts";
import { readVersion } from "./routes.ts";

const HOST = "127.0.0.1"; // localhost only: this server runs AI agents with the user's permissions
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const { values } = parseArgs({
  options: { dev: { type: "boolean", default: false }, port: { type: "string" } },
});
const dev = Boolean(values.dev);
const port = Number(values.port ?? process.env.AGENT_OS_PORT ?? (dev ? 4781 : 4780));
const env = loadEnv(appDir);
const version = dev ? "source" : readVersion(appDir);

const { server, token } = await createAgentOsNexo({ appDir, env, port, dev, version });

server.listen(port, HOST, () => {
  console.log(`agent-os-nexo ${version} → http://localhost:${port}/?token=${token} (environment: ${env.root})`);
});
// Open WebSockets (terminals, sessions) would keep close() waiting; the process owns nothing that needs draining.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
// Last line of defense: a promise some module forgot to handle is logged, not allowed to end every session.
process.on("unhandledRejection", (error) => console.error("[agent-os-nexo] unhandled rejection:", error));
