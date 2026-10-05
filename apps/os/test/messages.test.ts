// Every module's dictionary shares one namespace at runtime (host/web/src/i18n.ts): two modules that translate the
// same English key differently would show whichever loaded last. Disambiguate with a context: "All::containers".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { addMessages, setLanguage, t } from "../host/web/src/i18n.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function messageFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) messageFiles(p, out);
    else if (e.name === "messages.ts") out.push(p);
  }
  return out;
}

test("no two modules translate the same key differently", async () => {
  const files = [join(root, "host/web/src/messages.ts"), ...messageFiles(join(root, "modules"))];
  const seen = new Map<string, { file: string; text: string }>();
  const clashes: string[] = [];
  for (const file of files) {
    const { es } = (await import(file)) as { es?: Record<string, string> };
    for (const [key, text] of Object.entries(es ?? {})) {
      const prev = seen.get(key);
      if (!prev) seen.set(key, { file, text });
      else if (prev.text !== text) clashes.push(`${JSON.stringify(key)}: ${relative(root, prev.file)} says ${JSON.stringify(prev.text)}, ${relative(root, file)} says ${JSON.stringify(text)}`);
    }
  }
  assert.ok(files.length > 10, "found the modules' dictionaries");
  assert.deepEqual(clashes, []);
});

test("a key's context is hidden in English and picks its own translation", () => {
  addMessages({ es: { All: "Todo", "All::containers": "Todos" } });
  setLanguage("en");
  assert.equal(t("All::containers"), "All");
  setLanguage("es");
  assert.equal(t("All::containers"), "Todos");
  assert.equal(t("All"), "Todo");
  assert.equal(t("Missing::ctx"), "Missing", "untranslated keys fall back without the context");
  for (const raw of ["connect ECONNREFUSED ::1:443", "std::io::Error", "::error::build failed", "a :: b"]) assert.equal(t(raw), raw, raw);
  setLanguage("en");
});
