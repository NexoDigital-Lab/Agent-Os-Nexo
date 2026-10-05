// versions: the builds API (/api/versions).
import { h, httpError } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { buildsState, pin } from "./builds.ts";

const register: ModuleServer = (ctx) => {
  ctx.api.get("/versions", h(() => buildsState(ctx.env.os, ctx.version)));
  ctx.api.put("/versions/pin", h((req) => {
    const { version } = req.body as { version?: string | null };
    if (version !== null && typeof version !== "string") throw httpError(400, "Expected { version: string | null }");
    try {
      pin(ctx.env.os, version);
    } catch (e) {
      throw httpError(404, (e as Error).message);
    }
    return buildsState(ctx.env.os, ctx.version);
  }));
};

export default register;
