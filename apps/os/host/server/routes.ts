// The host's own API (/api/os/*): what the web needs before any module loads — which modules are active,
// the running version (and whether a newer build is waiting), and the user's preferences.
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import express from "express";
import { readState, setEnabled, writeState, type Discovery } from "../../src/core/modules.ts";
import { newerBuild } from "../../src/core/versions.ts";
import type { Env } from "./env.ts";
import { h, httpError, readJson, writeJson } from "./http.ts";

export interface HostInfo {
  version: string;
  dev: boolean;
  /** A newer build in os/versions/: "restart to load it". Never loaded automatically. */
  newer: string | null;
  environment: string;
  /** From library/profile.json: the language agents answer in, the UI's default language. */
  language: string | null;
  user: string | null;
}

export interface ModuleRow {
  id: string;
  name: string;
  version: string;
  description: string;
  parent: string | null;
  core: boolean;
  dependsOn: string[];
  /** Not turned off by the user. */
  enabled: boolean;
  /** Running now (enabled, with all its dependencies, when the server started). */
  active: boolean;
  nav: { label: string; icon?: string; order?: number } | null;
  /** Why it is not running although enabled: its server failed to load (or a dependency's did). */
  error: string | null;
}

/** Free-form UI preferences (theme, language…), shared by every build. */
export type Prefs = Record<string, unknown>;

export function hostRoutes(opts: { env: Env; appDir: string; version: string; dev: boolean; discovery: Discovery; active: string[]; modulesFile: string; failed: ReadonlyMap<string, string> }) {
  const { env, version, dev, discovery, active, modulesFile, failed } = opts;
  const prefsFile = join(env.data, "prefs.json");
  const r = express.Router();

  r.get("/os/info", h((): HostInfo => {
    const profile = readJson<{ language?: string; identity?: { name?: string } }>(join(env.library, "profile.json"), {});
    return {
      version,
      dev,
      newer: dev ? null : newerBuild(env.os, version),
      environment: env.root,
      language: profile.language ?? null,
      user: profile.identity?.name ?? null,
    };
  }));

  r.get("/os/modules", h((): ModuleRow[] => {
    const disabled = new Set(readState(modulesFile).disabled);
    // Load order (dependencies first), then the inactive ones: the web loads its entries in this order.
    const rank = (id: string) => (active.includes(id) ? active.indexOf(id) : active.length);
    const sorted = [...discovery.modules].sort((a, b) => rank(a.id) - rank(b.id));
    return sorted.map((m) => ({
      id: m.id,
      name: m.manifest.name,
      version: m.manifest.version,
      description: m.manifest.description,
      parent: m.parent,
      core: Boolean(m.manifest.core),
      dependsOn: m.manifest.dependsOn ?? [],
      enabled: !disabled.has(m.id),
      active: active.includes(m.id),
      nav: m.manifest.nav ?? null,
      error: failed.get(m.id) ?? null,
    }));
  }));

  // Takes effect on the next start, like a new build: the running modules stay as they are.
  r.put("/os/modules", h((req) => {
    const { id, enabled } = req.body as { id?: string; enabled?: boolean };
    if (!id || typeof enabled !== "boolean") throw httpError(400, "Expected { id, enabled }");
    try {
      writeState(modulesFile, setEnabled(discovery.modules, readState(modulesFile), id, enabled));
    } catch (e) {
      throw httpError(409, (e as Error).message);
    }
    return { ok: true, restart: true };
  }));

  r.get("/os/prefs", h((): Prefs => readJson<Prefs>(prefsFile, {})));
  r.put("/os/prefs", h((req): Prefs => {
    const patch = req.body as Prefs;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw httpError(400, "Expected an object");
    const next = { ...readJson<Prefs>(prefsFile, {}), ...patch };
    mkdirSync(dirname(prefsFile), { recursive: true });
    writeJson(prefsFile, next);
    return next;
  }));

  return r;
}

/** The version a build runs as: its personal version from build.json (os/versions/<x.y.z>), else the package's. */
export function readVersion(appDir: string): string {
  const build = readJson<{ version?: string }>(join(appDir, "build.json"), {});
  return build.version ?? (JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { version: string }).version;
}
