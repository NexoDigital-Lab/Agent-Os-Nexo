import { join } from "node:path";
import { packageDir } from "./paths.ts";
import { readJson } from "./fsx.ts";

export function nexoVersion(): string {
  return readJson<{ version: string }>(join(packageDir, "package.json")).version;
}
