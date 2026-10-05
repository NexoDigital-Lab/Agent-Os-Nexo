// The docs routes against a small fixture: index per language with English fallback, search, and documents.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { ModuleContext } from "../../../host/server/module-api.ts";

const dir = mkdtempSync(join(tmpdir(), "docs-mod-"));
const doc = (title: string, body: string, order = 1) => `---\ntitle: ${title}\nsummary: about ${title}\norder: ${order}\n---\n\n# ${title}\n\n${body}\n`;
mkdirSync(join(dir, "en"), { recursive: true });
mkdirSync(join(dir, "es"), { recursive: true });
writeFileSync(join(dir, "en", "rules.md"), doc("Rules", "Colors come from the theme. The theme has tokens.", 2));
writeFileSync(join(dir, "en", "start.md"), doc("Start", "Install it.", 1));
writeFileSync(join(dir, "es", "start.md"), doc("Empezar", "Instalalo.", 1));
process.env.NEXO_DOCS_DIR = dir;

const app = express();
const api = express.Router();
app.use("/api", api);
const { default: register } = await import("../server/index.ts");
await register({ api } as unknown as ModuleContext);
// Like the host (main.ts): an httpError becomes its status and { error }.
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message });
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
after(() => (server.close(), rmSync(dir, { recursive: true, force: true })));
const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: (await res.json()) as any };
};

test("the index is in reading order, per language", async () => {
  assert.deepEqual((await get("/docs?lang=en")).body.docs.map((d: any) => d.slug), ["start", "rules"]);
  assert.deepEqual((await get("/docs?lang=es")).body.docs.map((d: any) => d.title), ["Empezar"]);
  assert.equal((await get("/docs?lang=xx")).body.lang, "en", "an unknown language reads English");
});

test("a document falls back to English when its translation is missing", async () => {
  assert.equal((await get("/docs/start?lang=es")).body.title, "Empezar");
  const rules = (await get("/docs/rules?lang=es")).body;
  assert.equal(rules.lang, "en");
  assert.equal((await get("/docs/nope")).status, 404);
  assert.equal((await get("/docs/..%2Fen%2Frules")).status, 404, "no way out of the docs folder");
});

test("search ranks title matches first and counts matches in the text", async () => {
  const { hits } = (await get("/docs/search?q=theme&lang=en")).body;
  assert.equal(hits[0].slug, "rules");
  assert.equal(hits[0].count, 2);
  assert.match(hits[0].snippet, /theme/);
  assert.deepEqual((await get("/docs/search?q=&lang=en")).body.hits, []);
  assert.equal((await get(`/docs/search?q=${"x".repeat(101)}`)).status, 400);
});
