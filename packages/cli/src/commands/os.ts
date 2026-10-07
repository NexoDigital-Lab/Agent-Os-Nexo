import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot } from "../core/paths.ts";
import { folder, readConfig } from "../core/config.ts";
import { activeVersion, listVersions, nextVersion, pinVersion } from "../core/osversions.ts";
import { abortUpdate, continueUpdate, updateSource } from "../core/osupdate.ts";
import { accessLink, buildVersion, defaultRunner, fetchSource, logFile, withRelease, openerFor, PORTS, runningPid, runningPort, startProcess, stopProcesses, type Runner } from "../core/osruntime.ts";
import { createDesktopShortcut } from "../core/desktopShortcut.ts";

export interface OsOptions {
  root?: string;
  from?: string;
  notes?: string;
  port?: string;
  preview?: boolean;
  all?: boolean;
  module?: string;
  continue?: boolean;
  abort?: boolean;
}

/** What install reaches outside the environment. Tests replace it so no real shortcut lands on a desktop. */
export const osDeps = { createDesktopShortcut };

/** The repository this CLI runs from (packages/cli/{src,dist}/commands → four up), where a desktop build may live. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const USAGE = "Use: status, versions, next, use <x.y.z|latest>, install [--from <dir>], build [--notes <text>], start [--port <n>], preview [--port <n>], stop [--preview|--all], open [--preview], check [--module <id>], update [--from <dir>|--continue|--abort].";

export async function os(action: string | undefined, arg: string | undefined, opts: OsOptions, run: Runner = defaultRunner): Promise<string> {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const osDir = folder(root, config, "os");
  const stateDir = folder(root, config, "state");
  const versions = listVersions(osDir);
  const active = activeVersion(osDir);
  const port = opts.port ? Number(opts.port) : undefined;
  const source = join(osDir, "source");
  const hasSource = existsSync(source) && readdirSync(source).length > 0;
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error(`Invalid --port ${opts.port}.`);

  switch (action ?? "status") {
    case "status": {
      const app = runningPid(stateDir, "app");
      const preview = runningPid(stateDir, "preview");
      const lines = [
        versions.length
          ? `agent-os ${active} (of ${versions.length} build(s)). Next build will be ${nextVersion(versions.at(-1) ?? null)}.`
          : hasSource
            ? "agent-os is copied into os/source but has no build yet: `nexo os build`."
            : "agent-os is not installed: `nexo os install`.",
      ];
      if (app) lines.push(`Running (pid ${app}) — log: ${logFile(stateDir, "app")}`);
      if (preview) lines.push(`Preview running (pid ${preview}) — log: ${logFile(stateDir, "preview")}`);
      return lines.join("\n");
    }
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
    case "install": {
      if (versions.length) throw new Error(`agent-os is already installed (${versions.length} build(s)). Use \`nexo os build\` for a new version.`);
      // A previous install that copied the source but failed to build picks up where it stopped.
      const fetched = hasSource && !opts.from ? "resumed with the source already in os/source" : fetchSource(osDir, opts.from, run);
      const version = buildVersion(osDir, "First build", run);
      const lines = [`agent-os installed (${fetched}) and built as ${version}.`, "Start it with `nexo os start`."];
      // Windows: a desktop shortcut to the desktop shell, so the app opens like any other program.
      const shortcut = osDeps.createDesktopShortcut(REPO_ROOT);
      if (shortcut) lines.push(`Desktop shortcut created: ${shortcut}`);
      return lines.join("\n");
    }
    case "build": {
      const version = buildVersion(osDir, opts.notes ?? "", run);
      const running = runningPid(stateDir, "app");
      return running
        ? `Built ${version}. The running agent-os will offer to restart into it; it never restarts on its own.`
        : `Built ${version}. Start it with \`nexo os start\`.`;
    }
    case "start":
    case "preview": {
      const which = action === "start" ? "app" : "preview";
      const { pid, version } = await startProcess(root, osDir, stateDir, which, port);
      const url = accessLink(stateDir, port ?? PORTS[which]);
      return which === "app"
        ? `agent-os ${version} started (pid ${pid}) → ${url}\nLog: ${logFile(stateDir, which)}`
        : `Preview of os/source started (pid ${pid}) → ${url} (reloads on every change)\nLog: ${logFile(stateDir, which)}`;
    }
    case "open": {
      // The running app's (or preview's) access link, opened in the browser: the way in after every restart.
      const which = opts.preview ? "preview" : "app";
      if (!runningPid(stateDir, which)) throw new Error(`agent-os ${which === "app" ? "" : "preview "}is not running: \`nexo os ${which === "app" ? "start" : "preview"}\` first.`);
      const link = accessLink(stateDir, runningPort(stateDir, which));
      const opener = openerFor();
      try {
        run(opener.cmd, opener.args(link), root);
      } catch {
        return `Could not open a browser. Open this link yourself:\n${link}`;
      }
      return `Opened ${link.replace(/token=\w+/, "token=…")}`;
    }
    case "stop": {
      // Just the app by default: an agent stopping its preview must never take down the agent-os it runs in.
      const stopped = stopProcesses(stateDir, opts.all ? ["app", "preview"] : opts.preview ? ["preview"] : ["app"]);
      return stopped.length ? `Stopped: ${stopped.join(", ")}.` : "agent-os was not running.";
    }
    case "update": {
      // A new Nexo release merged into the user's version (osupdate.ts): their changes stay, conflicts are shown.
      if (opts.continue) {
        continueUpdate(source);
        return "Update finished. Check it with `nexo os check`, look at it with `nexo os preview`, then `nexo os build`.";
      }
      if (opts.abort) {
        abortUpdate(source);
        return "Update abandoned: os/source is back to how it was.";
      }
      const r = withRelease(opts.from, run, (dir) => updateSource(source, dir));
      if (r.conflicts.length) {
        return [
          `Merging agent-os ${r.to} into your version (${r.from}) left conflicts in:`,
          ...r.conflicts.map((f) => `  ${f}`),
          "Resolve them in os/source (or ask an agent: it keeps your change and takes Nexo's where they don't clash),",
          "then `nexo os update --continue` — or `nexo os update --abort` to leave your version as it was.",
        ].join("\n");
      }
      return `Your version now has agent-os ${r.to} (was ${r.from}), your changes kept. Check it with \`nexo os check\`, look at it with \`nexo os preview\`, then \`nexo os build\`.`;
    }
    case "check": {
      // The mechanical module rules (os/source/docs/en/module-rules.md), run by the source's own checker.
      const script = join(source, "scripts", "check-modules.ts");
      if (!existsSync(script)) throw new Error("No agent-os source with a module checker in os/source. Run `nexo os install`.");
      const r = spawnSync(process.execPath, [script, ...(opts.module ? [`--module=${opts.module}`] : [])], { cwd: source, encoding: "utf8" });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
      if (r.status !== 0) throw new Error(out || `The module checker failed (exit ${r.status}).`);
      return out;
    }
    default:
      throw new Error(`Unknown action "${action}". ${USAGE}`);
  }
}
