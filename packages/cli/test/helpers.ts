import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { init } from "../src/commands/init.ts";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "nexo-test-"));
  dirs.push(dir);
  return dir;
}

/** A fresh environment created non-interactively. */
export async function freshEnv(tools = "claude,gemini"): Promise<string> {
  const root = join(tempDir(), "env");
  await init({ root, yes: true, tools, preset: "normal", name: "Tester", email: "tester@example.com", language: "en", memory: "none" });
  return root;
}
