// agent-os server: discovers the modules, mounts the active ones, and serves the web UI — one process,
// one port, localhost only. `--dev` serves the UI through Vite (used for the preview of os/source).
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import express, { type NextFunction, type Request, type Response } from "express";
import { activeModules, discoverModules, readState } from "../../src/core/modules.ts";
import { loadEnv } from "./env.ts";
import { guardRequest } from "./http.ts";
import type { ModuleContext, ModuleServer } from "./module-api.ts";
import { hostRoutes, readVersion } from "./routes.ts";

const HOST = "127.0.0.1"; // localhost only: this server runs AI agents with the user's permissions
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const { values } = parseArgs({
  options: { dev: { type: "boolean", default: false }, port: { type: "string" } },
});
const dev = Boolean(values.dev);
const port = Number(values.port ?? process.env.AGENT_OS_PORT ?? (dev ? 4781 : 4780));
const env = loadEnv(appDir);
const version = dev ? "source" : readVersion(appDir);

const discovery = discoverModules(join(appDir, "modules"));
for (const problem of discovery.problems) console.warn(`[modules] ${problem}`);
const modulesFile = join(env.data, "modules.json");
const active = activeModules(discovery.modules, readState(modulesFile));

const app = express();
app.use(guardRequest(port)); // before everything, Vite's middleware included
app.use(express.json({ limit: "2mb" }));
const api = express.Router();
app.use("/api", api);
const server = createServer(app);

api.use(hostRoutes({ env, appDir, version, dev, discovery, active, modulesFile }));

for (const id of active) {
  const mod = discovery.modules.find((m) => m.id === id);
  const entry = mod?.manifest.entry?.server;
  if (!mod || !entry) continue;
  const ctx: ModuleContext = {
    id,
    env,
    api,
    dataDir: join(env.data, id),
    stateDir: join(env.state, id),
    server,
    port,
    dev,
    version,
  };
  mkdirSync(ctx.dataDir, { recursive: true });
  mkdirSync(ctx.stateDir, { recursive: true });
  const register = (await import(pathToFileURL(join(mod.dir, entry)).href)).default as ModuleServer;
  await register(ctx);
}

api.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Unknown API route" });
});
api.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

if (dev) {
  // Vite is a dev dependency: only the preview of os/source loads it.
  const { createServer: createVite } = await import("vite");
  // Hot reload rides on this same server and port.
  const vite = await createVite({
    configFile: join(appDir, "vite.config.ts"),
    server: { middlewareMode: true, ws: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const web = join(appDir, "dist", "web");
  if (!existsSync(join(web, "index.html"))) throw new Error(`This build has no web UI (${web}). Rebuild it with \`nexo os build\`.`);
  app.use(express.static(web, { index: false }));
  app.get("/{*path}", (_req, res) => res.sendFile(join(web, "index.html")));
}

server.listen(port, HOST, () => {
  console.log(`agent-os ${version} → http://localhost:${port} (environment: ${env.root})`);
});
// Open WebSockets (terminals, sessions) would keep close() waiting; the process owns nothing that needs draining.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
