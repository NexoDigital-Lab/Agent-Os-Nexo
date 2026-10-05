// http: the HTTP client's store and sender (/api/http).
import { h, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { initStore, readStore, send, writeStore } from "./client.ts";

const register: ModuleServer = (ctx) => {
  initStore(ctx.dataDir);
  ctx.api.get("/http", h(() => readStore()));
  ctx.api.put("/http", h((req) => (writeStore(req.body), ok)));
  ctx.api.post("/http/send", h((req) => send(req.body)));
};

export default register;
