import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProjects, listProjects, projectDir, projectIds, projectPath, worktreeNames, worktreePath } from "../server/projects.ts";
import { listFeatures, nextFeatureId, parseFeature, readFeature, setFeatureField, writeFeature } from "../server/features.ts";
import type { Env } from "../../../host/server/env.ts";

const root = mkdtempSync(join(tmpdir(), "agent-os-projects-"));
after(() => rmSync(root, { recursive: true, force: true }));
const projects = join(root, "projects");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

function project(rel: string, withCode = true) {
  const dir = join(projects, rel);
  mkdirSync(join(dir, "context"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# p\n");
  if (withCode) {
    mkdirSync(join(dir, "code"));
    git(join(dir, "code"), "init", "-q", "-b", "main");
    git(join(dir, "code"), "-c", "user.name=T", "-c", "user.email=t@e", "commit", "-q", "--allow-empty", "-m", "first");
  }
  return dir;
}

const shop = project("shop");
project("crm-ws/api");
project("crm-ws/web", false);
writeFileSync(join(projects, "crm-ws", "AGENTS.md"), "# ws\n"); // the workspace itself is not a project
mkdirSync(join(projects, "notes")); // no AGENTS.md: not a project
initProjects({ projects } as Env);

test("finds standalone projects and workspace parts, never the workspace itself", () => {
  assert.deepEqual(projectIds(), ["crm-ws/api", "crm-ws/web", "shop"]);
  assert.equal(projectDir("crm-ws"), null);
  assert.equal(projectDir("../etc"), null);
  assert.equal(projectPath("crm-ws/web"), null, "no code/ yet");
  assert.equal(projectPath("shop"), join(shop, "code"));
});

test("lists projects with branch, workspace and last commit", async () => {
  const all = await listProjects();
  const api = all.find((p) => p.id === "crm-ws/api")!;
  assert.equal(api.name, "api");
  assert.equal(api.workspace, "crm");
  assert.equal(api.branch, "main");
  assert.equal(api.lastCommit?.subject, "first");
  const web = all.find((p) => p.id === "crm-ws/web")!;
  assert.equal(web.path, null);
});

test("worktrees live in worktrees/<name> and must belong to the project's repo", () => {
  git(join(shop, "code"), "worktree", "add", "-q", "-b", "feat-x", join(shop, "worktrees", "feat-x"));
  mkdirSync(join(shop, "worktrees", "stray"));
  assert.deepEqual(worktreeNames("shop"), ["feat-x"]);
  assert.equal(worktreePath("shop", "stray"), null);
  assert.equal(worktreePath("shop", "feat-x"), join(shop, "worktrees", "feat-x"));
});

test("features: write, list, read, update status", () => {
  assert.equal(nextFeatureId(shop), "0001");
  const slug = writeFeature(shop, { title: "Añadir login con Google", type: "feature", size: "M", criteria: ["Logs in"] });
  assert.equal(slug, "0001-anadir-login-con-google");
  assert.equal(nextFeatureId(shop), "0002");
  const [f] = listFeatures(shop);
  assert.equal(f?.title, "Añadir login con Google");
  assert.equal(f?.status, "todo");
  setFeatureField(shop, slug, "status", "doing");
  assert.equal(listFeatures(shop)[0]?.status, "doing");
  assert.match(readFeature(shop, slug)!, /- \[ \] Logs in/);
  assert.equal(readFeature(shop, "../../AGENTS"), null);
  assert.match(readFileSync(join(shop, "context/features", `${slug}.md`), "utf8"), /^---\nid: "0001"/);
});

test("old feature files: fix becomes bug, title falls back to the heading", () => {
  const f = parseFeature("0003-x", "---\ntype: fix\n---\n# Broken menu\n", 0);
  assert.equal(f.type, "bug");
  assert.equal(f.title, "Broken menu");
  assert.equal(f.id, "0003");
});
