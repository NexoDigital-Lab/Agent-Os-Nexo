// Test harness for a module's server code: a throwaway Nexo environment, the module's register() mounted on a real
// Express app as main.ts does it (JSON body, /api router, the same error middleware), listening on a free port.
import { after } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { envAt, CONFIG_FILE, type Env } from "../server/env.ts";
import type { ModuleContext, ModuleServer } from "../server/module-api.ts";

// Tests compare bytes: git must not turn LF into CRLF on checkout, whatever the machine's config (Windows runners set
// core.autocrlf=true). Every git a test spawns inherits this.
process.env.GIT_CONFIG_PARAMETERS = "'core.autocrlf=false' 'core.eol=lf'";

/** A temporary folder, removed when the test file ends. */
export function tempDir(prefix = "agent-os-nexo-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      // Windows keeps files locked while a handle is open (a database, a child's cwd): the OS empties its temp later.
      if (process.platform !== "win32") throw error;
    }
  });
  return dir;
}

/** A minimal Nexo environment (environment.config.json and its folders) in a temporary folder. */
export function tempEnv(config: Record<string, unknown> = {}): Env {
  const root = tempDir("agent-os-nexo-env-");
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ name: "test", ...config }));
  const env = envAt(root);
  for (const dir of [env.library, env.projects, env.blueprints, env.data, env.state]) mkdirSync(dir, { recursive: true });
  return env;
}

export interface Mounted {
  ctx: ModuleContext;
  /** http://127.0.0.1:<port>/api */
  base: string;
  server: Server;
  /** fetch against the API: JSON in and out. `body` is sent as JSON when given. */
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any; headers: Headers }>;
  get: (path: string) => Promise<{ status: number; body: any; headers: Headers }>;
}

/**
 * Mounts `register` under /api like the host does and starts listening. The server closes when the test file ends.
 * `ctx` overrides any context field (id, env, dev, version…).
 */
export async function mountModule(register: ModuleServer, ctx: Partial<ModuleContext> = {}): Promise<Mounted> {
  const env = ctx.env ?? tempEnv();
  const id = ctx.id ?? "test";
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const api = express.Router();
  app.use("/api", api);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const context: ModuleContext = {
    id,
    env,
    api,
    dataDir: join(env.data, id),
    stateDir: join(env.state, id),
    server,
    port,
    dev: false,
    version: "0.0.0-test",
    ...ctx,
  };
  mkdirSync(context.dataDir, { recursive: true });
  mkdirSync(context.stateDir, { recursive: true });
  await register(context);
  api.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Unknown API route" });
  });
  api.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${port}/api`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON: keep the text
    }
    return { status: res.status, body: parsed as any, headers: res.headers };
  };
  return { ctx: context, base, server, call, get: (path) => call("GET", path) };
}
