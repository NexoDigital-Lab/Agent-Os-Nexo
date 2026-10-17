// monitor: usage and cost from every AI CLI's local session records (/api/usage/*) and the plan's limits (/api/limits).
import { h, httpError } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { contributeToSessions } from "../../sessions/server/contributions.ts";
import { PROVIDERS, listSessions, usageSummary } from "../../sessions/server/usage.ts";
import { limits, noteRateLimit } from "./limits.ts";

const register: ModuleServer = (ctx) => {
  // Every turn's rate-limit messages feed the plan meter (5 h / weekly utilization).
  contributeToSessions({ onMessage: (_tab, msg) => msg.type === "rate_limit_event" && noteRateLimit(msg.rate_limit_info) });
  const provider = (q: unknown) => {
    const p = String(q ?? "all");
    if (p !== "all" && !PROVIDERS.includes(p)) throw httpError(400, `unknown provider: ${p}`);
    return p;
  };
  ctx.api.get("/usage/summary", h((req) => usageSummary(Number(req.query.days ?? 7), provider(req.query.provider))));
  ctx.api.get("/usage/sessions", h((req) => listSessions(Number(req.query.days ?? 7), provider(req.query.provider))));
  ctx.api.get("/limits", h(() => limits()));
};

export default register;
