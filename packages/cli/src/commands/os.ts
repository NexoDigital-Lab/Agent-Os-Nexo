import { join } from "node:path";
import { findRoot } from "../core/paths.ts";
import { folder, readConfig } from "../core/config.ts";
import { activeVersion, listVersions, nextVersion, pinVersion } from "../core/osversions.ts";

export function os(action: string | undefined, arg: string | undefined, opts: { root?: string }): string {
  const root = findRoot(opts.root);
  const osDir = folder(root, readConfig(root), "os");
  const versions = listVersions(osDir);
  const active = activeVersion(osDir);

  switch (action ?? "status") {
    case "status":
      return versions.length
        ? `agent-os ${active} (of ${versions.length} build(s)). Next build will be ${nextVersion(versions.at(-1) ?? null)}.`
        : "agent-os has no builds yet. Source goes in os/source/, builds in os/versions/<x.y.z>/.";
    case "versions":
      return versions.length
        ? versions.map((v) => `${v === active ? "*" : " "} ${v}`).join("\n")
        : "No builds in os/versions/ yet.";
    case "next":
      return nextVersion(versions.at(-1) ?? null);
    case "use": {
      if (!arg) throw new Error("Usage: nexo os use <x.y.z|latest>");
      if (arg === "latest") {
        pinVersion(osDir, null);
        return `agent-os will load the newest build (${versions.at(-1) ?? "none yet"}) on next start.`;
      }
      if (!versions.includes(arg)) throw new Error(`No build ${arg} in ${join(osDir, "versions")}.`);
      pinVersion(osDir, arg);
      return `agent-os will load ${arg} on next start. Restart it yourself when ready.`;
    }
    default:
      throw new Error(`Unknown action "${action}". Use: status, versions, next, use <x.y.z|latest>.`);
  }
}
