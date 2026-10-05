import { join } from "node:path";
import { findRoot } from "../core/paths.ts";
import { folder, readConfig } from "../core/config.ts";
import { activeVersion, listVersions, nextVersion, pinVersion } from "../core/osversions.ts";
import { buildVersion, defaultRunner, fetchSource, logFile, PORTS, runningPid, startProcess, stopProcesses, type Runner } from "../core/osruntime.ts";

export interface OsOptions {
  root?: string;
  from?: string;
  notes?: string;
  port?: string;
  preview?: boolean;
}

const USAGE = "Use: status, versions, next, use <x.y.z|latest>, install [--from <dir>], build [--notes <text>], start [--port <n>], preview [--port <n>], stop [--preview].";

export function os(action: string | undefined, arg: string | undefined, opts: OsOptions, run: Runner = defaultRunner): string {
  const root = findRoot(opts.root);
  const config = readConfig(root);
  const osDir = folder(root, config, "os");
  const stateDir = folder(root, config, "state");
  const versions = listVersions(osDir);
  const active = activeVersion(osDir);
  const port = opts.port ? Number(opts.port) : undefined;
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error(`Invalid --port ${opts.port}.`);

  switch (action ?? "status") {
    case "status": {
      const app = runningPid(stateDir, "app");
      const preview = runningPid(stateDir, "preview");
      const lines = [
        versions.length
          ? `agent-os ${active} (of ${versions.length} build(s)). Next build will be ${nextVersion(versions.at(-1) ?? null)}.`
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
      const fetched = fetchSource(osDir, opts.from, run);
      const version = buildVersion(osDir, "First build", run);
      return [`agent-os installed (${fetched}) and built as ${version}.`, "Start it with `nexo os start`."].join("\n");
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
      const { pid, version } = startProcess(root, osDir, stateDir, which, port);
      const url = `http://localhost:${port ?? PORTS[which]}`;
      return which === "app"
        ? `agent-os ${version} started (pid ${pid}) → ${url}\nLog: ${logFile(stateDir, which)}`
        : `Preview of os/source started (pid ${pid}) → ${url} (reloads on every change)\nLog: ${logFile(stateDir, which)}`;
    }
    case "stop": {
      const stopped = stopProcesses(stateDir, opts.preview ? ["preview"] : ["app", "preview"]);
      return stopped.length ? `Stopped: ${stopped.join(", ")}.` : "agent-os was not running.";
    }
    default:
      throw new Error(`Unknown action "${action}". ${USAGE}`);
  }
}
