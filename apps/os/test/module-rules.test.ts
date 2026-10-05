// The module rules (docs/en/module-rules.md) hold for every module in this repository, and the checker really
// catches each rule it claims to (a checker that always passes would hide every regression).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkModules } from "../scripts/check-modules.ts";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every module in this repository follows the mechanical rules", () => {
  const findings = checkModules(appDir).map((f) => `${f.rule} ${f.file}${f.line ? `:${f.line}` : ""} — ${f.message}`);
  assert.deepEqual(findings, [], "run `node scripts/check-modules.ts` and fix per docs/en/module-rules.md");
});

const fixture = mkdtempSync(join(tmpdir(), "module-rules-"));
after(() => rmSync(fixture, { recursive: true, force: true }));

function write(rel: string, text: string) {
  mkdirSync(dirname(join(fixture, rel)), { recursive: true });
  writeFileSync(join(fixture, rel), text);
}

test("the checker catches every rule on a module that breaks them all", () => {
  const manifest = (name: string, extra = {}) => JSON.stringify({ name, version: "1.0.0", description: "x", owner: "nexo", ...extra });
  write("host/web/src/messages.ts", 'export const es: Record<string, string> = {\n  "Save": "Guardar",\n};\n');
  write("modules/base/module.json", manifest("base", { entry: { web: "web/index.tsx" } }));
  write("modules/base/web/index.tsx", 'import { es } from "./messages";\nexport default { messages: { es } };\n');
  write("modules/base/web/messages.ts", 'export const es: Record<string, string> = {\n  "Open": "Abrir",\n};\n');
  write("modules/other/module.json", manifest("other"));
  write("modules/other/web/thing.ts", "export const thing = 1;\n");
  // "bad": no owner, a missing entry, imports a module it doesn't declare, a fixed color, untranslated text,
  // a dictionary that clashes with base's, and a messages.ts its entry never registers.
  write("modules/bad/module.json", JSON.stringify({ name: "bad", version: "1.0.0", description: "x", dependsOn: ["base"], entry: { server: "server/index.ts", web: "web/index.tsx" } }));
  write("modules/bad/web/index.tsx", 'import { thing } from "../../other/web/thing";\nimport { t } from "@os/i18n";\nexport const label = t("Save") + t("Never translated") + thing;\nexport default {};\n');
  write("modules/bad/web/bad.css", ".x { color: #ff0000; background: var(--bg); }\n");
  write("modules/bad/web/ask.ts", 'export const sure = () => window.confirm("Sure?");\n');
  write("modules/bad/web/messages.ts", 'export const es: Record<string, string> = {\n  "Open": "Abrí",\n};\n');

  const findings = checkModules(fixture);
  const hit = (rule: string, pattern: RegExp) => assert.ok(findings.some((f) => f.rule === rule && pattern.test(f.message)), `${rule} ${pattern}: ${JSON.stringify(findings, null, 1)}`);
  hit("M1", /owner is missing/);
  hit("M1", /entry\.server points to a missing file/);
  hit("M2", /module "other", which is not in dependsOn/);
  hit("M3", /hardcoded color #ff0000/);
  hit("M4", /t\("Never translated"\) has no Spanish/);
  hit("M4", /does not register messages/);
  hit("M5", /"Open" is "(Abrí|Abrir)" here/);
  hit("M6", /confirm\(\) — use @os\/lib\/dialog/);
  assert.ok(!findings.some((f) => /t\("Save"\)/.test(f.message)), "host translations count for every module");
  assert.ok(!findings.some((f) => f.module === "base" && f.rule !== "M5"), "a clean module has no findings");
});
