// VS Code's CLI: list/install extensions and open a project or file in it.
import { spawn } from "node:child_process";
import { findBin, httpError, run } from "../../../host/server/http.ts";
import { safePath } from "./repo.ts";

/** VS Code's CLI, searched in the user bin dirs plus the flatpak exports. */
const CODE_BIN = findBin("code", ["/var/lib/flatpak/exports/bin"]) ?? findBin("com.visualstudio.code", ["/var/lib/flatpak/exports/bin"]) ?? "code";

/** A Marketplace id: publisher.name. */
export const VSCODE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** "agent-os-nexo.*" ids exist only in agent-os-nexo's own editor, never in VS Code. */
export const isEditorOnly = (id: string) => id.startsWith("agent-os-nexo.");

let installedCache: { at: number; ids: Set<string> | null } | null = null;
export async function installed(bin = CODE_BIN): Promise<Set<string> | null> {
  if (installedCache && Date.now() - installedCache.at < 20_000) return installedCache.ids;
  const ids = await run(bin, ["--list-extensions"], { timeout: 20_000 }).then(
    (r) => new Set(r.stdout.split("\n").filter(Boolean).map((s) => s.toLowerCase())),
    () => null, // no `code` on PATH
  );
  installedCache = { at: Date.now(), ids };
  return ids;
}

export async function installExtension(id: string, bin = CODE_BIN) {
  if (!VSCODE_ID.test(id) || isEditorOnly(id)) throw httpError(400, "Invalid extension id");
  try {
    await run(bin, ["--install-extension", id], { timeout: 180_000 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw httpError(500, `code --install-extension failed: ${(e.stderr || e.message).trim()}`);
  }
  installedCache = null;
  return { ok: true };
}

/** Opens the project (or one file at a line) in VS Code, falling back to the desktop default. */
export function openInEditor(root: string, rel?: string, line?: number, launch: typeof spawn = spawn, bin = CODE_BIN) {
  const target = rel ? `${safePath(root, rel)}${line ? `:${line}` : ""}` : root;
  const args = rel ? ["-g", target] : [root];
  const child = launch(bin, args, { detached: true, stdio: "ignore" });
  child.on("error", () => launch("xdg-open", [rel ? safePath(root, rel) : root], { detached: true, stdio: "ignore" }).unref());
  child.unref();
}
