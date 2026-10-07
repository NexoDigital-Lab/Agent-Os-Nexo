import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../../../host/server/env.ts";
import { listFeatures } from "../../projects/server/features.ts";
import { initProjects } from "../../projects/server/projects.ts";
import { acceptProposals, deleteNote, initNotes, listDrafts, listNotes, promoteDrafts, saveNote, type Proposal } from "../server/notes.ts";

const root = mkdtempSync(join(tmpdir(), "agent-os-nexo-notes-"));
after(() => rmSync(root, { recursive: true, force: true }));
const projects = join(root, "projects");
mkdirSync(join(projects, "shop"), { recursive: true });
writeFileSync(join(projects, "shop", "AGENTS.md"), "# shop\n");
mkdirSync(join(root, "data"));
initProjects({ projects } as Env);
initNotes(join(root, "data"));

const p = (title: string): Proposal => ({ title, type: "feature", priority: "P1", size: "S", description: "d", criteria: ["works", ""], why: "w", sourceNotes: [] });

test("notes are saved, updated and deleted", () => {
  const n = saveNote({ title: "ideas", project: "shop", body: "login" });
  saveNote({ id: n.id, body: "login with google" });
  assert.equal(listNotes()[0]?.body, "login with google");
  assert.throws(() => saveNote({ project: "../etc" }), /Invalid project/);
  deleteNote(n.id);
  assert.equal(listNotes().length, 0);
});

test("accepted proposals become features for an existing project, drafts for a new one", () => {
  const r = acceptProposals("shop", [p("Login")]);
  assert.equal(r.features.length, 1);
  const f = listFeatures(join(projects, "shop"))[0];
  assert.equal(f?.title, "Login");
  assert.equal(f?.priority, "P1");
  assert.deepEqual(acceptProposals("future-app", [p("Setup"), p("Auth")]), { features: [], drafts: 2 });
  assert.equal(listDrafts().length, 2);
  assert.throws(() => promoteDrafts("future-app"), /doesn't exist yet/);
  mkdirSync(join(projects, "future-app"));
  writeFileSync(join(projects, "future-app", "AGENTS.md"), "# f\n");
  assert.equal(promoteDrafts("future-app").length, 2);
  assert.equal(listDrafts().length, 0);
  assert.equal(listFeatures(join(projects, "future-app")).length, 2);
});
