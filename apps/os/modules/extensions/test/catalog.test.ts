// The catalog is data the UI and the recommender trust: ids must be valid and unique, editor plugins consistent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byId, CATALOG, isEditorOnly, VSCODE_ID } from "../server/catalog.ts";

test("every catalog id is a valid, unique Marketplace id", () => {
  for (const e of CATALOG) assert.match(e.id, VSCODE_ID, e.id);
  assert.equal(new Set(CATALOG.map((e) => e.id.toLowerCase())).size, CATALOG.length);
  assert.equal(byId.size, CATALOG.length);
});

test("agent-os.* entries are editor-only and always map to an editor plugin", () => {
  const only = CATALOG.filter((e) => isEditorOnly(e.id));
  assert.ok(only.length > 0);
  for (const e of only) assert.ok(e.editor, e.id);
  assert.equal(isEditorOnly("esbenp.prettier-vscode"), false);
});

test("byId is case-insensitive by lowercased key", () => {
  assert.equal(byId.get("prisma.prisma")?.name, "Prisma");
  assert.equal(byId.get("Prisma.prisma"), undefined, "callers lowercase first");
});
