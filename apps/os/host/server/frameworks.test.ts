// The shared view of frameworks: the CLI's JSON read defensively, the pickable methods, the change counter, and the
// environment default read from environment.config.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../test/harness.ts";
import { CONFIG_FILE, envFramework } from "./env.ts";
import { bumpFrameworks, frameworksVersion, parseFrameworksList, pickableMethods } from "./frameworks.ts";

test("parseFrameworksList keeps well-formed entries, defaults the rest, and refuses non-JSON", () => {
  const list = parseFrameworksList(JSON.stringify({
    default: "corp",
    frameworks: [
      { name: "corp", kind: "method", enabled: true, hookCommands: ["a", 5], contributions: { skills: ["s"], hooks: 2 }, isDefault: true },
      { name: "t", kind: "tool", enabled: false },
      { name: "Bad Name" },
    ],
    broken: ["x"],
  }));
  assert.equal(list.default, "corp");
  assert.deepEqual(list.frameworks.map((f) => f.name), ["corp", "t"]);
  assert.deepEqual(list.frameworks[0]!.hookCommands, ["a"]);
  assert.deepEqual(list.frameworks[0]!.contributions, { skills: ["s"], agents: [], commands: [], mcpServers: [], instructions: [], hooks: 2 });
  assert.deepEqual(pickableMethods(list).map((f) => f.name), ["corp"], "tools and disabled ones are not picked");
  assert.deepEqual(list.broken, ["x"]);
  assert.throws(() => parseFrameworksList("nope"), /not JSON/);
  assert.throws(() => parseFrameworksList("[]"), /cannot list frameworks/);
});

test("the change counter moves on every bump", () => {
  const v = frameworksVersion();
  bumpFrameworks();
  assert.equal(frameworksVersion(), v + 1);
});

test("envFramework: the configured name, else nexo (missing, empty, unreadable)", () => {
  const root = tempDir();
  assert.equal(envFramework(root), "nexo", "no config at all");
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ framework: "corp" }));
  assert.equal(envFramework(root), "corp");
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ framework: "" }));
  assert.equal(envFramework(root), "nexo");
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ framework: 3 }));
  assert.equal(envFramework(root), "nexo");
});
