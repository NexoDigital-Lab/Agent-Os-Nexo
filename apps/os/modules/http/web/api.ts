import { call } from "@os/lib/http";
import type { HttpResult, HttpStore } from "../server/client.ts";
export type { Collection, Env, HttpRequest, HttpResult, HttpStore, KV } from "../server/client.ts";

export const httpApi = {
  httpStore: () => call<HttpStore>("GET", "/api/http"),
  saveHttpStore: (s: HttpStore) => call("PUT", "/api/http", s),
  httpSend: (r: { method: string; url: string; headers: [string, string][]; body?: string }) => call<HttpResult>("POST", "/api/http/send", r),
};
