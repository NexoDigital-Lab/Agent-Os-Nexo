// Agent memory with Engram: archives, the pinned install, the command, the connection per AI and the proxy's filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { deflateRawSync, gzipSync } from "node:zlib";
import type { ChildProcess } from "node:child_process";
import { freshEnv, tempDir } from "./helpers.ts";
import { tarGzMember, zipMember } from "../src/core/archive.ts";
import { assetFor, engramPaths, installEngram, sha256, type EngramPin } from "../src/core/engram.ts";
import { allowedTools, engramArgs, engramEnv, filterCall, fromClient, fromServer, NEXO_MEMORY_INSTRUCTIONS, runProxy } from "../src/core/memoryproxy.ts";
import { memory, memoryProject, memoryWrites } from "../src/commands/memory.ts";
import { readConfig } from "../src/core/config.ts";
import { redact as cliRedact } from "../src/core/redact.ts";
import { writeJson } from "../src/core/fsx.ts";
import { create } from "../src/commands/project.ts";

/** A ustar archive with the given files (`L` long-name entries for names over 100 bytes). */
function tarGz(files: Record<string, Buffer | string>): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0);
    h.write("0000644\0", 100);
    h.write(size.toString(8).padStart(11, "0") + "\0", 124);
    h.write(type, 156);
    h.write("ustar\0", 257);
    return h;
  };
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body);
    if (name.length > 100) {
      blocks.push(header("././@LongLink", name.length + 1, "L"), pad(Buffer.from(`${name}\0`)));
    }
    blocks.push(header(name, data.length, "0"), pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A zip with each file deflated (method 8) or stored (method 0). */
function zip(files: Record<string, { body: string; stored?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, { body, stored }] of Object.entries(files)) {
    const raw = Buffer.from(body);
    const data = stored ? raw : deflateRawSync(raw);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("archives: one file by base name from tar.gz (long names too) and zip (deflated or stored)", () => {
  const long = `${"d".repeat(120)}/engram`;
  assert.equal(tarGzMember(tarGz({ "tools/x.sh": "x", engram: "BIN" }), "engram")?.toString(), "BIN");
  assert.equal(tarGzMember(tarGz({ [long]: "LONG" }), "engram")?.toString(), "LONG");
  assert.equal(tarGzMember(tarGz({ other: "x" }), "engram"), null);
  assert.equal(zipMember(zip({ "a/": { body: "" }, "engram.exe": { body: "EXE" } }), "engram.exe")?.toString(), "EXE");
  assert.equal(zipMember(zip({ "engram.exe": { body: "RAW", stored: true } }), "engram.exe")?.toString(), "RAW");
  assert.equal(zipMember(zip({ x: { body: "x" } }), "engram.exe"), null);
  assert.throws(() => zipMember(Buffer.from("not a zip at all, definitely not"), "x"), /Not a zip/);
});

/** A pin whose linux-x64 asset is `archive`. */
function pinFor(archive: Buffer, version = "9.9.9"): EngramPin {
  return { name: "engram", version, repo: "o/r", license: "MIT", assets: { [`${process.platform}-${process.arch}`]: { file: process.platform === "win32" ? "e.zip" : "e.tar.gz", sha256: sha256(archive) } } };
}
const releaseArchive = () => (process.platform === "win32" ? zip({ "engram.exe": { body: "BIN" } }) : tarGz({ engram: "BIN" }));

test("install: downloads the pinned asset, refuses other bytes, writes the binary once", async () => {
  const root = await freshEnv();
  const paths = engramPaths(root, readConfig(root));
  const archive = releaseArchive();
  const urls: string[] = [];
  const pin = pinFor(archive);
  const first = await installEngram(paths, pin, async (url) => (urls.push(url), archive));
  assert.equal(first.downloaded, true);
  assert.match(urls[0]!, /^https:\/\/github\.com\/o\/r\/releases\/download\/v9\.9\.9\/e\./);
  assert.equal(readFileSync(first.binary, "utf8"), "BIN");
  assert.equal(existsSync(paths.data), true);
  assert.equal((await installEngram(paths, pin, async () => assert.fail("no second download"))).downloaded, false);

  await assert.rejects(installEngram(paths, pinFor(archive, "1.0.0"), async () => Buffer.from("tampered")), /does not match the pinned SHA-256/);
  const empty = process.platform === "win32" ? zip({ x: { body: "x" } }) : tarGz({ x: "x" });
  await assert.rejects(installEngram(paths, pinFor(empty, "2.0.0"), async () => empty), /has no engram/);
  assert.throws(() => assetFor(pin, "plan9", "mips"), /no release for plan9-mips/);
});

test("nexo memory: install wires the connection per AI, status, update, remove keeps the data", async () => {
  const root = await freshEnv("claude,opencode,codex");
  const archive = releaseArchive();
  const deps = { pin: pinFor(archive), fetcher: async () => archive };
  assert.match(String(await memory("status", { root }, deps)), /Agent memory is off/);
  await assert.rejects(memory("update", { root }, deps), /memory is off/);
  assert.match(String(await memory("install", { root }, deps)), /Installed Engram .* 9\.9\.9/);
  assert.equal(readConfig(root).memory, "engram");
  const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  assert.deepEqual(mcp.mcpServers.memory, { command: "nexo", args: ["memory", "mcp", "--ai", "claude"], env: {} });
  assert.deepEqual(JSON.parse(readFileSync(join(root, "opencode.json"), "utf8")).mcp.memory.command, ["nexo", "memory", "mcp", "--ai", "opencode"]);
  assert.match(readFileSync(join(root, ".codex", "config.toml"), "utf8"), /args = \["memory","mcp","--ai","codex"\]|args = \["memory", "mcp", "--ai", "codex"\]/);
  assert.match(String(await memory("status", { root }, deps)), /on · pinned 9\.9\.9 · installed 9\.9\.9/);
  assert.equal(JSON.parse(String(await memory("status", { root, json: true }, deps))).connection, true);

  // A raised pin: update installs it and drops the old version.
  const next = { pin: pinFor(archive, "9.9.10"), fetcher: async () => archive };
  assert.match(String(await memory("update", { root }, next)), /Updated to .* 9\.9\.10 .*\n.*removed 9\.9\.9/);

  writeFileSync(join(engramPaths(root, readConfig(root)).data, "engram.db"), "data");
  assert.match(String(await memory("remove", { root }, next)), /memories stay in/);
  assert.equal(readConfig(root).memory, "none");
  assert.equal(existsSync(join(root, "library", "connections", "memory.json")), false);
  assert.equal(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers?.memory, undefined);
  assert.equal(readFileSync(join(engramPaths(root, readConfig(root)).data, "engram.db"), "utf8"), "data");
  await assert.rejects(memory("mcp", { root, ai: "claude" }, next), /memory is off/);
  await assert.rejects(memory("mcp", { root, ai: "bash" }, next), /Usage/);
  await assert.rejects(memory("nope", { root }, next), /Usage/);
});

test("project and write policy: pinned to the Nexo project; OpenCode reads only unless writes are allowed", async () => {
  const root = await freshEnv();
  const config = readConfig(root);
  create("shop", { root });
  create("api", { root, ws: "acme" });
  const projects = join(root, "projects");
  assert.equal(memoryProject(root, config, join(projects, "shop", "code", "src")), "shop");
  assert.equal(memoryProject(root, config, join(projects, "acme-ws", "api", "code")), "acme-ws-api");
  assert.equal(memoryProject(root, config, root), "environment");
  assert.equal(memoryWrites(root, config, join(projects, "shop"), "claude"), true, "normal preset: connections * write ask");
  assert.equal(memoryWrites(root, config, join(projects, "shop"), "opencode"), false);
  writeJson(join(projects, "shop", "context", "permissions.json"), { connections: { memory: { write: "allow" } } });
  assert.equal(memoryWrites(root, config, join(projects, "shop", "code"), "opencode"), true, "a project can allow it");
  writeJson(join(projects, "acme-ws", "api", "context", "permissions.json"), { connections: { memory: { write: "deny" } } });
  assert.equal(memoryWrites(root, config, join(projects, "acme-ws", "api"), "claude"), false);
});

const policy = { ai: "claude", project: "shop", writes: true };

test("filter: allowlist, read-only, pinned project, no prompts, secrets masked or refused, provenance", () => {
  assert.equal(allowedTools({ ...policy, writes: false }).includes("mem_save"), false);
  for (const banned of ["mem_save_prompt", "mem_delete", "mem_merge_projects", "mem_list_projects", "mem_capture_passive"]) {
    assert.equal(filterCall(policy, banned, {}).ok, false, banned);
  }
  assert.match((filterCall({ ...policy, writes: false }, "mem_save", {}) as { error: string }).error, /only read/);

  const search = filterCall(policy, "mem_search", { query: "q", project: "other", all_projects: true, scope: "global" });
  assert.deepEqual(search, { ok: true, args: { query: "q" } });
  const save = filterCall(policy, "mem_save", { title: "t", content: "token: ghp_abcdefghijklmnopqrstuvwxyz123456", capture_prompt: true, project: "x", directory: "/x" });
  assert.deepEqual(save, { ok: true, args: { title: "t", content: "token: [redacted]\n\n[via claude]", capture_prompt: false, scope: "project" } });
  const update = filterCall(policy, "mem_update", { id: 3, content: "c [via claude]", expected_project: "other" });
  assert.deepEqual(update, { ok: true, args: { id: 3, content: "c [via claude]", expected_project: "shop" } });
  for (const cite of ["read projects/shop/secrets/db.txt", ".state/os/token", "C:\\env\\os\\data\\vault\\k"]) {
    assert.equal(filterCall(policy, "mem_save", { title: "t", content: cite }).ok, false, cite);
  }
  assert.equal(filterCall(policy, "mem_search", { query: "secrets/ folder?" }).ok, true, "reads may mention them");
  assert.deepEqual(filterCall(policy, "mem_context", null), { ok: true, args: {} });
});

test("messages: refusals answered locally, initialize gets Nexo's instructions, tools/list filtered", () => {
  const pending = new Map<unknown, string>();
  assert.match(fromClient(policy, "{bad", pending).toClient!, /Parse error/);
  const refused = fromClient(policy, JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "mem_delete", arguments: { id: 1 } } }), pending);
  assert.equal(refused.toServer, undefined);
  assert.equal(JSON.parse(refused.toClient!).result.isError, true);
  assert.equal(pending.has(7), false);

  const init = fromClient(policy, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), pending);
  assert.ok(init.toServer);
  const initReply = fromServer(policy, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { instructions: "MANDATORY: save everything" } }), pending);
  assert.equal(JSON.parse(initReply).result.instructions, NEXO_MEMORY_INSTRUCTIONS);
  fromClient(policy, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), pending);
  const tools = JSON.parse(fromServer(policy, JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "mem_search" }, { name: "mem_delete" }] } }), pending));
  assert.deepEqual(tools.result.tools, [{ name: "mem_search" }]);
  const call = JSON.parse(fromClient(policy, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mem_search", arguments: { query: "q", project: "x" } } }), pending).toServer!);
  assert.deepEqual(call.params.arguments, { query: "q" });
  assert.equal(fromServer(policy, "not json", pending), "not json");
  assert.equal(fromServer(policy, JSON.stringify({ jsonrpc: "2.0", id: 99, result: {} }), pending), JSON.stringify({ jsonrpc: "2.0", id: 99, result: {} }));
  assert.equal(fromServer(policy, JSON.stringify({ jsonrpc: "2.0", id: 3, error: { code: 1 } }), pending), JSON.stringify({ jsonrpc: "2.0", id: 3, error: { code: 1 } }));
});

test("Engram's process: no ENGRAM_* from the caller, data folder set, tools and project as flags", () => {
  const env = engramEnv({ PATH: "/bin", ENGRAM_CLOUD_TOKEN: "t", engram_port: "1", ENGRAM_DATA_DIR: "/elsewhere" }, "/env/os/data/engram");
  assert.deepEqual(env, { PATH: "/bin", ENGRAM_DATA_DIR: "/env/os/data/engram" });
  assert.deepEqual(engramArgs({ ...policy, writes: false }), ["mcp", "--tools=mem_search,mem_context,mem_get_observation,mem_current_project,mem_suggest_topic_key", "--project=shop"]);
});

/** A fake Engram: answers initialize and echoes each tools/call's arguments. */
function fakeEngram(seen: { args?: string[]; env?: NodeJS.ProcessEnv }) {
  return (args: string[], env: NodeJS.ProcessEnv): ChildProcess => {
    seen.args = args;
    seen.env = env;
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr: new PassThrough() });
    let buf = "";
    stdin.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        const result = msg.method === "initialize" ? { instructions: "theirs" } : { echo: msg.params?.arguments };
        stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
      }
    });
    stdin.on("end", () => {
      stdout.end();
      child.emit("close", 0);
    });
    return child;
  };
}

test("runProxy: lines flow both ways through the filter; closing stdin ends Engram", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const out: string[] = [];
  stdout.on("data", (d: Buffer) => out.push(...d.toString().split("\n").filter(Boolean)));
  const seen: { args?: string[]; env?: NodeJS.ProcessEnv } = {};
  const done = runProxy(policy, "/bin/engram", "/data", { stdin, stdout, stderr: new PassThrough(), start: fakeEngram(seen) });
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n\n`);
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mem_save", arguments: { title: "t", content: "c" } } })}\n`);
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mem_delete", arguments: {} } })}\n`);
  await new Promise((r) => setTimeout(r, 50));
  stdin.end();
  assert.equal(await done, 0);
  const byId = Object.fromEntries(out.map((l) => JSON.parse(l)).map((m) => [m.id, m]));
  assert.equal(byId[1].result.instructions, NEXO_MEMORY_INSTRUCTIONS);
  assert.deepEqual(byId[2].result.echo, { title: "t", content: "c\n\n[via claude]", capture_prompt: false, scope: "project" });
  assert.equal(byId[3].result.isError, true);
  assert.equal(seen.env?.ENGRAM_DATA_DIR, "/data");
  assert.equal(seen.args?.[2], "--project=shop");
});

test("runProxy: an Engram that cannot start is exit 1 with a readable error", async () => {
  const stderr = new PassThrough();
  let err = "";
  stderr.on("data", (d: Buffer) => (err += d.toString()));
  const start = () => {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    Object.assign(child, { stdin: new PassThrough(), stdout: null, stderr: null });
    setImmediate(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  assert.equal(await runProxy(policy, "/missing/engram", "/d", { stdin: new PassThrough(), stdout: new PassThrough(), stderr, start }), 1);
  assert.match(err, /Engram could not start \(\/missing\/engram\): ENOENT/);
});

test("the CLI's redact is agent-os's redact", () => {
  assert.equal(cliRedact("password=hunter2"), "password=[redacted]");
  assert.equal(cliRedact("postgres://u:p@h/db"), "postgres://[redacted]@h/db");
  assert.equal(cliRedact("image: api:latest"), "image: api:latest");
  assert.equal(readFileSync(new URL("../src/core/redact.ts", import.meta.url), "utf8").split("\n").slice(2).join("\n"), readFileSync(new URL("../../../apps/os/host/server/redact.ts", import.meta.url), "utf8").split("\n").slice(2).join("\n"), "same rules, line for line");
});

test("nexo memory mcp runs the proxy with the project's policy (fake Engram)", async () => {
  const root = await freshEnv();
  const archive = releaseArchive();
  const pin = pinFor(archive);
  await memory("install", { root }, { pin, fetcher: async () => archive });
  await assert.rejects(memory("mcp", { root, ai: "claude" }, { pin: pinFor(archive, "0.0.1") }), /not installed/);
  create("shop", { root });
  const prev = process.cwd();
  process.chdir(join(root, "projects", "shop"));
  try {
    const stdin = new PassThrough();
    const seen: { args?: string[] } = {};
    const done = memory("mcp", { root, ai: "opencode" }, { pin, io: { stdin, stdout: new PassThrough(), stderr: new PassThrough(), start: fakeEngram(seen) } });
    stdin.end();
    assert.equal(await done, 0);
    assert.match(seen.args!.join(" "), /--tools=mem_search,[^ ]*mem_suggest_topic_key --project=shop/);
    assert.doesNotMatch(seen.args!.join(" "), /mem_save/);
  } finally {
    process.chdir(prev);
  }
});

test("doctor lists Engram as third party and warns when its binary or connection is gone", async () => {
  const { diagnose } = await import("../src/commands/doctor.ts");
  const root = await freshEnv();
  const archive = releaseArchive();
  const pin = pinFor(archive, (await import("../src/core/engram.ts")).readPin().version);
  await memory("install", { root }, { pin, fetcher: async () => archive });
  const memoryFindings = () => diagnose(root).filter((f) => f.area === "memory");
  assert.deepEqual(memoryFindings().map((f) => f.level), ["ok"]);
  assert.match(memoryFindings()[0]!.message, /third party, MIT/);
  rmSync(join(root, "library", "connections", "memory.json"));
  rmSync(engramPaths(root, readConfig(root)).base, { recursive: true });
  assert.deepEqual(memoryFindings().map((f) => f.level), ["ok", "warn", "warn"]);
});
