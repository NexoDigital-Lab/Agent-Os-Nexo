// Stand-ins for the programs the project lifecycle shells out to (gh, gio, the nexo CLI), so the tests never touch
// GitHub, the desktop trash or a real nexo install. Each is a tiny node script driven by FAKE_* env vars.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tempDir } from "../../../host/test/harness.ts";

const GH = `
const { appendFileSync } = require("node:fs");
const a = process.argv.slice(2);
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify(a) + "\\n");
const e = process.env;
const fail = (msg) => (process.stderr.write(msg + "\\n"), process.exit(1));
const key = a.slice(0, 2).join(" ");
if (key === "repo view" && a.includes("name")) e.FAKE_GH_EXISTS ? process.exit(0) : fail("not found");
else if (key === "repo view") e.FAKE_GH_VIEW_FAIL ? fail("no view") : console.log(e.FAKE_GH_URL || "https://github.com/me/fake");
else if (key === "repo create") e.FAKE_GH_CREATE_FAIL ? fail("create refused") : console.log(e.FAKE_GH_CREATE_OUT ?? "https://github.com/me/created");
else if (key === "repo list") e.FAKE_GH_LIST_FAIL ? fail("list refused") : console.log(e.FAKE_GH_LIST ?? "[]");
else if (key === "repo delete") e.FAKE_GH_DELETE_FAIL ? fail("delete refused") : process.exit(0);
else if (key === "api user") e.FAKE_GH_USER ? console.log(e.FAKE_GH_USER) : fail("no user");
else if (key === "auth status") e.FAKE_GH_AUTH ? process.stderr.write(e.FAKE_GH_AUTH) : fail("not logged in");
`;

const GIO = `
const { renameSync, mkdirSync } = require("node:fs");
const { join, basename } = require("node:path");
if (process.env.FAKE_GIO_FAIL) (process.stderr.write("trash unavailable\\n"), process.exit(1));
mkdirSync(process.env.FAKE_TRASH, { recursive: true });
const src = process.argv[3];
renameSync(src, join(process.env.FAKE_TRASH, basename(src) + "-" + Date.now()));
`;

// Only the commands the lifecycle uses: new and clone, creating the folders the real CLI would.
const NEXO = `
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const a = process.argv.slice(2);
const opt = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
if (process.env.FAKE_NEXO_FAIL) (process.stderr.write("nexo broke\\n"), process.exit(1));
const name = a[0] === "new" ? a[1] : opt("--name");
const ws = opt("--ws");
const dir = join(opt("--root"), "projects", ws ? ws + "-ws" : "", name);
mkdirSync(join(dir, "code"), { recursive: true });
mkdirSync(join(dir, "context"), { recursive: true });
writeFileSync(join(dir, "AGENTS.md"), "# " + name + "\\n");
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: join(dir, "code") });
`;

/** Fake gh/gio on PATH and a fake nexo CLI; returns where the call log and the trash are. Unix only. */
export function installFakes(): { log: string; trash: string } {
  const bin = tempDir("agent-os-nexo-fakebin-");
  mkdirSync(bin, { recursive: true });
  for (const [name, src] of [["gh", GH], ["gio", GIO]] as const) {
    const f = join(bin, name);
    writeFileSync(f, `#!${process.execPath}\n${src}`);
    chmodSync(f, 0o755);
  }
  const nexo = join(bin, "nexo-cli.cjs");
  writeFileSync(nexo, NEXO);
  const log = join(bin, "calls.log");
  const trash = join(bin, "trash");
  process.env.PATH = bin + delimiter + process.env.PATH;
  process.env.NEXO_CLI = nexo;
  process.env.FAKE_LOG = log;
  process.env.FAKE_TRASH = trash;
  // Commits made by the lifecycle use the ambient git identity; CI machines may have none.
  Object.assign(process.env, { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@e.st", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e.st" });
  return { log, trash };
}
