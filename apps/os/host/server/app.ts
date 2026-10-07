// The agent-os server, assembled: discovers the modules, mounts the active ones and serves the web UI on one HTTP
// server. main.ts starts it on the command line; tests start it on a free port.
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { activeModules, discoverModules, readState } from "../../src/core/modules.ts";
import type { Env } from "./env.ts";
import { issueAccess } from "./access.ts";
import { guardRequest } from "./http.ts";
import type { ModuleContext, ModuleServer } from "./module-api.ts";
import { mountModules } from "./mount.ts";
import { hostRoutes } from "./routes.ts";

export interface AppOptions {
  /** The agent-os folder: a build (os/versions/<x.y.z>) or the source. */
  appDir: string;
  env: Env;
  port: number;
  /** Serve the UI through Vite (the preview of os/source) instead of dist/web. */
  dev: boolean;
  version: string;
  /** Where problems found while loading are reported. */
  warn?: (message: string) => void;
}

export interface App {
  server: Server;
  /** This run's access token (access.ts). */
  token: string;
  /** Module id → why its server did not load. */
  failed: ReadonlyMap<string, string>;
}

/** Builds the server, ready to `listen(port, "127.0.0.1")`. Throws when a build has no web UI. */
export async function createAgentOs(opts: AppOptions): Promise<App> {
  const { appDir, env, port, dev, version, warn = console.warn } = opts;
  const discovery = discoverModules(join(appDir, "modules"));
  for (const problem of discovery.problems) warn(`[modules] ${problem}`);
  const modulesFile = join(env.data, "modules.json");
  const active = activeModules(discovery.modules, readState(modulesFile));

  const app = express();
  const token = issueAccess(env.state, port);
  app.use(guardRequest(port)); // before everything, Vite's middleware included
  app.use(express.json({ limit: "2mb" }));
  const api = express.Router();
  app.use("/api", api);
  const server = createServer(app);

  const failed = new Map<string, string>();
  api.use(hostRoutes({ env, appDir, version, dev, discovery, active, modulesFile, failed }));

  await mountModules({
    modules: discovery.modules,
    active,
    failed,
    context: (mod): ModuleContext => {
      const ctx = { id: mod.id, env, api, dataDir: join(env.data, mod.id), stateDir: join(env.state, mod.id), server, port, dev, version };
      mkdirSync(ctx.dataDir, { recursive: true });
      mkdirSync(ctx.stateDir, { recursive: true });
      return ctx;
    },
    load: async (mod, entry) => (await import(pathToFileURL(join(mod.dir, entry)).href)).default as ModuleServer,
  });

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
  return { server, token, failed };
}
