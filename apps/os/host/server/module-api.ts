// The contract between the host and a module's server code (modules/<name>/server/index.ts).
import type { Server } from "node:http";
import type { Router } from "express";
import type { Env } from "./env.ts";

export interface ModuleContext {
  /** "editor" for a module, "editor/lsp" for a submodule. */
  id: string;
  env: Env;
  /** Mounted at /api, shared by every module: register routes with their full path under /api. */
  api: Router;
  /** os/data/<id>: this module's persistent data (exists before register runs). */
  dataDir: string;
  /** .state/os/<id>: regenerable files: logs, caches, indexes (exists before register runs). */
  stateDir: string;
  /** The HTTP server, for WebSocket upgrades (check `sameOrigin` first). */
  server: Server;
  port: number;
  /** True when running from source with Vite's dev server (the preview), false for a build. */
  dev: boolean;
  /** The agent-os version running (package version for a build, "source" in dev). */
  version: string;
}

/** Default export of modules/<name>/server/index.ts. */
export type ModuleServer = (ctx: ModuleContext) => void | Promise<void>;
