// extensions.ts + routes against a throwaway environment. The agent SDK is a fake `ask`; `code` is never asked to install.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mountModule, tempEnv } from "../../../host/test/harness.ts";
import { run } from "../../../host/server/http.ts";
import { initSkills } from "../../sessions/server/skills.ts";
import { initProjects } from "../../projects/server/projects.ts";
import * as ext from "../server/extensions.ts";
import register from "../server/index.ts";

const env = tempEnv();
initProjects(env);
initSkills(env);
const m = await mountModule(register, { id: "extensions", env });

/** A project with AGENTS.md and a code/ folder; `files` are written inside code/. */
async function project(id: string, files: Record<string, string> = {}) {
  const dir = join(env.projects, id);
  const code = join(dir, "code");
  mkdirSync(code, { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# p\n");
  await run("git", ["init", "-q", code]); // stack detection lists files through git
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(code, f, ".."), { recursive: true });
    writeFileSync(join(code, f), c);
  }
  return { dir, code };
}
const generalFile = join(env.library, "extensions.json");
const DEFAULT = ["pkief.material-icon-theme", "esbenp.prettier-vscode", "usernamehw.errorlens", "agent-os-nexo.brackets", "agent-os-nexo.emmet"];

test("general list defaults, then saves only valid unique ids", async () => {
  const first = (await m.get("/extensions")).body;
  assert.deepEqual(first.general, DEFAULT);
  assert.ok(first.catalog.length > 10);
  const r = await m.call("PUT", "/extensions/general", { general: ["a.b", "a.b", "nodot", 5, "x.y"] });
  assert.deepEqual(r.body, { general: ["a.b", "x.y"] });
  assert.deepEqual(JSON.parse(readFileSync(generalFile, "utf8")), { general: ["a.b", "x.y"] });
  assert.deepEqual((await m.call("PUT", "/extensions/general", { general: "nope" })).body, { general: [] });
  await m.call("PUT", "/extensions/general", { general: DEFAULT });
});

test("install rejects ids that are invalid or only exist in agent-os-nexo", async () => {
  assert.equal((await m.call("POST", "/extensions/install", { id: "no-dot" })).status, 400);
  assert.equal((await m.call("POST", "/extensions/install", { id: "agent-os-nexo.emmet" })).status, 400);
  assert.equal((await m.call("POST", "/extensions/install", {})).status, 400);
});

test("unknown or code-less projects are 404", async () => {
  assert.equal((await m.get("/projects/ghost/extensions")).status, 404);
  const dir = join(env.projects, "nocode");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "");
  assert.equal((await m.get("/projects/nocode/extensions")).status, 404);
  assert.equal((await m.call("PUT", "/projects/ghost/extensions", {})).status, 404);
  assert.equal((await m.call("POST", "/projects/ghost/extensions/sync")).status, 404);
  assert.equal((await m.call("POST", "/projects/ghost/extensions/recommend")).status, 404);
});

test("a project's view recommends by stack, minus what is general, chosen or dismissed", async () => {
  await project("web", { "package.json": JSON.stringify({ dependencies: { react: "1", tailwindcss: "3" } }) });
  const v = (await m.get("/projects/web/extensions")).body;
  assert.equal(v.name, "web");
  assert.equal(v.managed, false);
  const ids = v.recommended.map((r: any) => r.id);
  assert.ok(ids.includes("dsznajder.es7-react-js-snippets") && ids.includes("bradlc.vscode-tailwindcss"));
  assert.ok(v.recommended.every((r: any) => r.source === "rules" && /^found /.test(r.why)));
  assert.deepEqual(v.editor, ["icons", "prettier", "errorlens", "brackets", "emmet"], "only chosen plugins, not recommended ones");

  const saved = (await m.call("PUT", "/projects/web/extensions", { extensions: ["bradlc.vscode-tailwindcss", "bad", "bradlc.vscode-tailwindcss"], dismissed: ["dsznajder.es7-react-js-snippets"] })).body;
  assert.deepEqual(saved.extensions, ["bradlc.vscode-tailwindcss"]);
  assert.equal(saved.managed, true);
  assert.ok(!saved.recommended.some((r: any) => r.id === "bradlc.vscode-tailwindcss" || r.id === "dsznajder.es7-react-js-snippets"));
  assert.ok(saved.editor.includes("tailwind"));
  assert.ok(existsSync(join(env.projects, "web", "context", "extensions.json")));
});

test("first look adopts the repo's .vscode recommendations (JSONC), minus the general ones", async () => {
  await project("adopt", {
    ".vscode/extensions.json": `{
  // comment
  /* block */
  "recommendations": ["ms-python.python", "esbenp.prettier-vscode", "not valid",],
}`,
  });
  const v = (await m.get("/projects/adopt/extensions")).body;
  assert.deepEqual(v.extensions, ["ms-python.python"]);
  assert.equal(v.vscode.exists, true);
  assert.equal(v.vscode.invalid, false);
  assert.equal(v.vscode.inSync, false, "the repo file lacks the general ids");
});

test("sync writes the wanted ids (no editor-only ones) and keeps the file's other keys", async () => {
  const { code } = await project("sync", { ".vscode/extensions.json": JSON.stringify({ unwantedRecommendations: ["x.y"] }) });
  await m.call("PUT", "/projects/sync/extensions", { extensions: ["golang.go"], dismissed: [] });
  const before = (await m.get("/projects/sync/extensions")).body;
  assert.equal(before.vscode.inSync, false);
  const after = (await m.call("POST", "/projects/sync/extensions/sync")).body;
  assert.equal(after.vscode.inSync, true);
  const file = JSON.parse(readFileSync(join(code, ".vscode", "extensions.json"), "utf8"));
  assert.deepEqual(file.unwantedRecommendations, ["x.y"]);
  assert.deepEqual(file.recommendations, ["pkief.material-icon-theme", "esbenp.prettier-vscode", "usernamehw.errorlens", "golang.go"]);
});

test("sync creates .vscode when missing, and refuses to overwrite an unreadable file", async () => {
  const { code } = await project("fresh");
  assert.equal((await m.get("/projects/fresh/extensions")).body.vscode.exists, false);
  await m.call("POST", "/projects/fresh/extensions/sync");
  assert.ok(existsSync(join(code, ".vscode", "extensions.json")));

  const broken = await project("broken", { ".vscode/extensions.json": "{ not json" });
  const view = (await m.get("/projects/broken/extensions")).body;
  assert.equal(view.vscode.invalid, true);
  assert.equal(view.vscode.inSync, false);
  const r = await m.call("POST", "/projects/broken/extensions/sync");
  assert.equal(r.status, 409);
  assert.match(r.body.error, /invalid JSON/);
  assert.equal(readFileSync(join(broken.code, ".vscode", "extensions.json"), "utf8"), "{ not json");
});

test("overview lists only projects with code, sorted, and reports whether VS Code answered", async () => {
  const o = (await m.get("/extensions")).body;
  const names = o.projects.map((p: any) => p.name);
  assert.deepEqual(names, [...names].sort((a: string, b: string) => a.localeCompare(b)));
  assert.ok(names.includes("web") && !names.includes("nocode"));
  assert.ok(o.installed === null || Array.isArray(o.installed));
});

// ---------- AI recommendations ----------
type Msg = Record<string, unknown>;
const fakeAsk = (msgs: Msg[], seen?: { prompt?: string; options?: any }) =>
  ((arg: { prompt: string; options: unknown }) => {
    if (seen) Object.assign(seen, arg);
    return (async function* () {
      for (const x of msgs) yield x;
    })();
  }) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;

test("recommendWithClaude filters ids, canonicalizes catalog ids, stores the result and shows it as ai", async () => {
  await project("ai", { "package.json": "{}" });
  const seen: { prompt?: string; options?: any } = {};
  const ask = fakeAsk([
    { type: "assistant" },
    {
      type: "result", subtype: "success", total_cost_usd: 0.02,
      structured_output: {
        summary: "A node app",
        recommendations: [
          { id: "prisma.PRISMA", name: "Prisma", why: "schema.prisma found" },
          { id: "someone.custom-tool", name: "N".repeat(200), why: "w".repeat(500) },
          { id: "agent-os-nexo.emmet", name: "Emmet", why: "editor only" },
          { id: "invalid id", name: "x", why: "y" },
        ],
      },
    },
  ], seen);
  const r = await ext.recommendWithClaude("ai", ask);
  assert.equal(r.summary, "A node app");
  assert.equal(r.cost, 0.02);
  const ai = r.recommended.filter((x) => x.source === "ai");
  assert.deepEqual(ai.map((x) => x.id), ["Prisma.prisma", "someone.custom-tool"]);
  assert.equal(ai[1]!.name.length, 80);
  assert.equal(ai[1]!.why.length, 300);
  assert.deepEqual(r.custom.map((x) => x.id), ["someone.custom-tool"]);
  assert.ok(r.aiAt && r.aiCost === 0.02);
  assert.match(seen.prompt!, /project "ai"/);
  assert.equal(seen.options.model, "haiku");
  assert.deepEqual(seen.options.tools, ["Read", "Glob", "Grep"]);
  const stored = JSON.parse(readFileSync(join(env.projects, "ai", "context", "extensions.json"), "utf8"));
  assert.equal(stored.ai.length, 2);
  // A later view of an id the user then chose does not repeat it as a recommendation.
  await m.call("PUT", "/projects/ai/extensions", { extensions: ["someone.custom-tool"], dismissed: [] });
  assert.ok(!(await m.get("/projects/ai/extensions")).body.recommended.some((x: any) => x.id === "someone.custom-tool"));
});

test("recommendWithClaude fails with 502 when the AI errors or returns nothing", async () => {
  await project("ai-fail");
  const err = await ext.recommendWithClaude("ai-fail", fakeAsk([{ type: "result", subtype: "error_max_turns", total_cost_usd: 0.1 }])).then(() => null, (e) => e);
  assert.equal(err.status, 502);
  assert.match(err.message, /error_max_turns/);
  const none = await ext.recommendWithClaude("ai-fail", fakeAsk([])).then(() => null, (e) => e);
  assert.match(none.message, /no output/);
  assert.equal(existsSync(join(env.projects, "ai-fail", "context", "extensions.json")), false);
});
