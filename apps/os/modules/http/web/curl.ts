// curl ⇄ request conversion, {{variable}} substitution, and Postman v2.1 collections (Thunder Client imports them).
import type { Collection, HttpRequest, KV } from "./api";
import { t as i18n } from "@os/i18n";

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Shell-style split: quotes, escapes and backslash-newline continuations, enough for pasted curls. */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let q: '"' | "'" | null = null;
  const src = cmd.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q === "'") {
      if (c === "'") q = null;
      else cur += c;
    } else if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\" && i + 1 < src.length && '"\\$`'.includes(src[i + 1])) cur += src[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === "\\" && i + 1 < src.length) {
      cur += src[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (q) throw new Error(i18n("Unclosed quotes in the curl command"));
  if (cur || has) out.push(cur);
  return out;
}

const DATA_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode", "--json"]);
const SKIP_WITH_ARG = new Set(["-o", "--output", "-w", "--write-out", "-m", "--max-time", "--connect-timeout", "-A", "--user-agent", "-e", "--referer", "-x", "--proxy", "--cacert", "--cert", "--key", "-c", "--cookie-jar"]);

export function parseCurl(cmd: string): Omit<HttpRequest, "id" | "name"> {
  const t = tokenize(cmd.trim());
  if (t[0] !== "curl") throw new Error(i18n("Paste a command that starts with curl"));
  let method = "";
  let url = "";
  const headers: KV[] = [];
  const data: string[] = [];
  let json = false;
  let get = false;
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    const next = () => {
      if (i + 1 >= t.length) throw new Error(`Falta el valor de ${a}`);
      return t[++i];
    };
    if (a === "-X" || a === "--request") method = next().toUpperCase();
    else if (a.startsWith("-X") && a.length > 2) method = a.slice(2).toUpperCase();
    else if (a === "-H" || a === "--header") {
      const h = next();
      const at = h.indexOf(":");
      if (at > 0) headers.push({ k: h.slice(0, at).trim(), v: h.slice(at + 1).trim(), on: true });
    } else if (DATA_FLAGS.has(a)) {
      if (a === "--json") json = true;
      data.push(next());
    } else if (a === "-u" || a === "--user") headers.push({ k: "Authorization", v: `Basic ${btoa(next())}`, on: true });
    else if (a === "-b" || a === "--cookie") headers.push({ k: "Cookie", v: next(), on: true });
    else if (a === "--url") url = next();
    else if (a === "-G" || a === "--get") get = true;
    else if (SKIP_WITH_ARG.has(a)) next();
    else if (!a.startsWith("-")) url = a;
  }
  if (!url) throw new Error(i18n("No URL found in the curl command"));
  const has = (k: string) => headers.some((h) => h.k.toLowerCase() === k);
  if (json) {
    if (!has("content-type")) headers.push({ k: "Content-Type", v: "application/json", on: true });
    if (!has("accept")) headers.push({ k: "Accept", v: "application/json", on: true });
  }
  let body = data.join("&");
  if (get && body) {
    url += (url.includes("?") ? "&" : "?") + body;
    body = "";
  }
  if (body && !has("content-type")) headers.push({ k: "Content-Type", v: "application/x-www-form-urlencoded", on: true });
  return { method: method || (body ? "POST" : "GET"), url, headers, body };
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(r: { method: string; url: string; headers: [string, string][]; body?: string }): string {
  const parts = [`curl -X ${r.method} ${sq(r.url)}`];
  for (const [k, v] of r.headers) parts.push(`-H ${sq(`${k}: ${v}`)}`);
  if (r.body && r.method !== "GET" && r.method !== "HEAD") parts.push(`--data-raw ${sq(r.body)}`);
  return parts.join(" \\\n  ");
}

/** Replaces {{name}} with the active environment's value; unknown names stay visible so the mistake shows. */
export function resolve(text: string, vars: KV[]): string {
  const map = new Map(vars.filter((v) => v.on && v.k).map((v) => [v.k, v.v]));
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => map.get(k) ?? m);
}

export function resolved(r: HttpRequest, vars: KV[]) {
  return {
    method: r.method,
    url: resolve(r.url.trim(), vars),
    headers: r.headers.filter((h) => h.on && h.k.trim()).map((h) => [resolve(h.k.trim(), vars), resolve(h.v, vars)] as [string, string]),
    body: resolve(r.body, vars),
  };
}

export function toPostman(c: Collection) {
  return {
    info: { name: c.name, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: c.requests.map((r) => ({
      name: r.name,
      request: {
        method: r.method,
        header: r.headers.map((h) => ({ key: h.k, value: h.v, disabled: !h.on })),
        url: { raw: r.url },
        ...(r.body ? { body: { mode: "raw", raw: r.body } } : {}),
      },
    })),
  };
}

/** Postman v2.1 (also what Thunder Client exports): folders are flattened into "folder / name". */
export function fromPostman(json: any): Collection {
  if (!json?.info || !Array.isArray(json.item)) throw new Error(i18n("This doesn't look like a Postman v2.1 collection"));
  const requests: HttpRequest[] = [];
  const walk = (items: any[], prefix: string) => {
    for (const it of items) {
      if (Array.isArray(it.item)) walk(it.item, `${prefix}${it.name} / `);
      else if (it.request) {
        const rq = it.request;
        requests.push({
          id: uid(),
          name: `${prefix}${it.name ?? "request"}`,
          method: (rq.method ?? "GET").toUpperCase(),
          url: typeof rq.url === "string" ? rq.url : rq.url?.raw ?? "",
          headers: (rq.header ?? []).map((h: any) => ({ k: h.key, v: h.value, on: !h.disabled })),
          body: rq.body?.mode === "raw" ? rq.body.raw ?? "" : "",
        });
      }
    }
  };
  walk(json.item, "");
  return { id: uid(), name: json.info.name ?? "Importada", requests };
}
