// providers: which AI provider CLIs are installed and which ones agent-os-nexo uses (/api/providers/*).
// Detection lives in host/server/providers.ts; this module only serves it and owns library/providers.json.
import { join } from "node:path";
import { h, httpError } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import {
  detectAll,
  detectProvider,
  providerById,
  readProvidersFile,
  writeProvidersFile,
  type DetectedProvider,
  type ProviderId,
} from "../../../host/server/providers.ts";

const CACHE_MS = 20_000; // detection is cheap but not free: like docker info, cache it briefly

const register: ModuleServer = (ctx) => {
  const file = () => join(ctx.env.library, "providers.json");
  let cache: { at: number; providers: DetectedProvider[] } | null = null;

  const snapshot = async () => {
    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), providers: await detectAll() };
    const cfg = readProvidersFile(file(), ctx.env.tools);
    return { providers: cache.providers, enabled: cfg.enabled, default: cfg.default };
  };

  const api = ctx.api;
  api.get("/providers", h(() => snapshot()));

  // enabled: array of registry ids (unknowns dropped, must stay non-empty); default: an id in enabled, or null.
  api.post("/providers/enabled", h((req) => {
    const body = req.body ?? {};
    if (!Array.isArray(body.enabled)) throw httpError(400, "enabled must be an array of provider ids");
    const rawEnabled: unknown[] = body.enabled;
    const enabled: ProviderId[] = [...new Set(rawEnabled.filter((x): x is ProviderId => typeof x === "string" && providerById(x) !== undefined))];
    if (!enabled.length) throw httpError(400, "enabled must contain at least one known provider id");
    const raw = body.default;
    let def: ProviderId;
    if (raw === null || raw === undefined) def = enabled[0]!;
    else if (typeof raw === "string" && enabled.includes(raw as ProviderId)) def = raw as ProviderId;
    else throw httpError(400, "default must be a known provider id present in enabled");
    writeProvidersFile(file(), { enabled, default: def });
    return snapshot();
  }));

  // Force re-detection of one provider, bypassing the cache (the Install/Test flow after adding a CLI).
  api.post("/providers/test", h(async (req) => {
    const id = String(req.body?.id ?? "");
    const meta = providerById(id);
    if (!meta) throw httpError(400, `Unknown provider: ${id}`);
    const provider = await detectProvider(meta);
    if (cache) cache = { at: Date.now(), providers: cache.providers.map((p) => (p.id === id ? provider : p)) };
    return { provider };
  }));
};

export default register;
