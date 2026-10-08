// The Context view's server: what it lists (AGENTS.md and context/ text files only), path confinement, the read-only
// permissions file, saves with a stale-copy check, opening in VS Code, and the note for the tab's agents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { contributions } from "../../sessions/server/contributions.ts";
import register from "../server/index.ts";
import { contextPath, promptNote } from "../server/context.ts";

const env = tempEnv();
initProjects(env);
const shop = join(env.projects, "shop");
for (const d of ["code", "context/features", "context/map", "secrets"]) mkdirSync(join(shop, d), { recursive: true });
writeFileSync(join(shop, "AGENTS.md"), "# shop\n");
writeFileSync(join(shop, "context", "README.md"), "# context\n");
writeFileSync(join(shop, "context", "features", "0001-login.md"), "---\nid: 1\n---\n");
writeFileSync(join(shop, "context", "map", "README.md"), "map\n");
writeFileSync(join(shop, "context", "permissions.json"), "{}\n");
writeFileSync(join(shop, "context", "logo.png"), "png");
writeFileSync(join(shop, "secrets", "token.md"), "SECRET");
writeFileSync(join(shop, "code", "notes.md"), "code");
const before = contributions().length;
const { call, get } = await mountModule(register, { env });
const base = "/projects/shop/context";

test("lists AGENTS.md and context/ text files — never secrets/, code/ or binaries", async () => {
  const list = (await get(base)).body as { path: string; readOnly: boolean }[];
  assert.deepEqual(list.map((f) => f.path), ["AGENTS.md", "context/permissions.json", "context/README.md", "context/features/0001-login.md", "context/map/README.md"]);
  assert.deepEqual(list.filter((f) => f.readOnly).map((f) => f.path), ["context/permissions.json"]);
  assert.equal((await get("/projects/nope/context")).status, 404);
});

test("paths stay inside AGENTS.md and context/, whatever the spelling", async () => {
  for (const p of ["secrets/token.md", "context/../secrets/token.md", "context\\..\\secrets\\token.md", "code/notes.md", "/etc/passwd.md", "context/logo.png", ""]) {
    const r = await get(`${base}/file?path=${encodeURIComponent(p)}`);
    assert.equal(r.status, 400, p);
    assert.doesNotMatch(JSON.stringify(r.body), /SECRET/);
  }
  assert.equal(contextPath("context", true), "context");
  assert.throws(() => contextPath("context"), /Only AGENTS.md/);
  assert.equal((await get(`${base}/file?path=context/missing.md`)).status, 404);
});

test("a symlink inside context/ is not followed", { skip: process.platform === "win32" && "symlinks need admin" }, async () => {
  symlinkSync(join(shop, "secrets", "token.md"), join(shop, "context", "leak.md"));
  assert.equal((await get(`${base}/file?path=context/leak.md`)).status, 400);
  assert.ok(!((await get(base)).body as { path: string }[]).some((f) => f.path === "context/leak.md"), "not listed either");
});

test("a linked folder inside context/ that points at secrets/ is neither read nor written through", { skip: process.platform === "win32" && "symlinks need admin" }, async () => {
  symlinkSync(join(shop, "secrets"), join(shop, "context", "vault"));
  assert.equal((await get(`${base}/file?path=context/vault/token.md`)).status, 400, "read refused");
  assert.equal((await call("PUT", `${base}/file`, { path: "context/vault/new.md", content: "x" })).status, 400, "write refused");
  assert.doesNotMatch(readFileSync(join(shop, "secrets", "token.md"), "utf8"), /^x$/);
});

test("read, save with the stale-copy check, create in an existing folder", async () => {
  const doc = (await get(`${base}/file?path=context/README.md`)).body;
  assert.equal(doc.content, "# context\n");
  const saved = await call("PUT", `${base}/file`, { path: "context/README.md", content: "# new\n", mtime: doc.mtime });
  assert.equal(saved.status, 200);
  assert.equal(readFileSync(join(shop, "context", "README.md"), "utf8"), "# new\n");
  utimesSync(join(shop, "context", "README.md"), new Date(), new Date(Date.now() + 5000));
  assert.equal((await call("PUT", `${base}/file`, { path: "context/README.md", content: "x", mtime: saved.body.mtime })).status, 409, "changed on disk meanwhile");
  assert.equal((await call("PUT", `${base}/file`, { path: "context/specs/new.md", content: "x" })).status, 400, "no new folders");
  assert.equal((await call("PUT", `${base}/file`, { path: "context/features/0002-cart.md", content: "# cart\n" })).status, 200);
  assert.equal((await call("PUT", `${base}/file`, { path: "AGENTS.md", content: 5 })).status, 400);
  assert.equal((await call("PUT", `${base}/file`, { path: "context/big.md", content: "x".repeat(1024 * 1024 + 1) })).status, 413);
});

test("permissions.json is read-only here", async () => {
  const r = await call("PUT", `${base}/file`, { path: "context/permissions.json", content: '{"default":"allow"}' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Agent permissions/);
  assert.equal(readFileSync(join(shop, "context", "permissions.json"), "utf8"), "{}\n");
});

test("a document larger than 1 MB is not read here", async () => {
  writeFileSync(join(shop, "context", "huge.md"), "x".repeat(1024 * 1024 + 10));
  assert.equal((await get(`${base}/file?path=context/huge.md`)).status, 413);
});

test("open in VS Code accepts only AGENTS.md, context/ and its files", async () => {
  assert.equal((await call("POST", `${base}/open`, { path: "secrets/token.md" })).status, 400);
  assert.equal((await call("POST", `${base}/open`, { path: "context/../code" })).status, 400);
});

test("the tab's agents are told where the context is", () => {
  const note = contributions()[before]!.promptNote!({ id: "t", title: "t", project: "shop", dir: shop, cwd: join(shop, "code") } as never);
  assert.match(String(note), /context\/README\.md \(start here\).*context\/map\/README\.md.*context\/features\//);
  assert.equal(contributions()[before]!.promptNote!({ project: "" } as never), null);
  assert.equal(promptNote("nope"), null);
  mkdirSync(join(env.projects, "bare"), { recursive: true });
  writeFileSync(join(env.projects, "bare", "AGENTS.md"), "# bare\n");
  initProjects(env);
  assert.equal(promptNote("bare"), null, "no context/ folder: nothing to say");
  mkdirSync(join(env.projects, "bare", "context"));
  assert.equal(promptNote("bare"), null, "an empty context/: nothing to point at");
});
