// The desktop installer download: the asset per OS/CPU, checksums required and verified, nothing saved on a mismatch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { freshEnv, tempDir } from "./helpers.ts";
import { os, osDeps } from "../src/commands/os.ts";
import { downloadDesktop, parseSums, pickAsset, RELEASES, type Fetch } from "../src/core/desktop.ts";

const NAMES = [
  "agent-os-nexo_0.2.0_amd64.AppImage", "agent-os-nexo_0.2.0_amd64.deb", "agent-os-nexo_0.2.0_aarch64.AppImage",
  "agent-os-nexo_0.2.0_aarch64.dmg", "agent-os-nexo_0.2.0_x64.dmg", "agent-os-nexo_0.2.0_x64-setup.exe", "agent-os-nexo_0.2.0_x64_en-US.msi",
];
const asset = (name: string) => ({ name, browser_download_url: `https://dl/${name}` });

test("pickAsset: AppImage on Linux, dmg on macOS, the NSIS setup on Windows, by CPU", () => {
  const assets = NAMES.map(asset);
  const pick = (p: string, a: string) => pickAsset(assets, p, a)?.name ?? null;
  assert.equal(pick("linux", "x64"), "agent-os-nexo_0.2.0_amd64.AppImage");
  assert.equal(pick("linux", "arm64"), "agent-os-nexo_0.2.0_aarch64.AppImage");
  assert.equal(pick("darwin", "arm64"), "agent-os-nexo_0.2.0_aarch64.dmg");
  assert.equal(pick("darwin", "x64"), "agent-os-nexo_0.2.0_x64.dmg");
  assert.equal(pick("win32", "x64"), "agent-os-nexo_0.2.0_x64-setup.exe");
  assert.equal(pick("win32", "arm64"), null);
  assert.equal(pick("freebsd", "x64"), null);
});

test("parseSums merges sha256sum files, with or without the binary-mode star", () => {
  const a = "a".repeat(64), b = "B".repeat(64);
  const sums = parseSums([`${a}  one.dmg\n`, `${b} *two.exe\r\nnot a line\n`]);
  assert.deepEqual([...sums], [["one.dmg", a], ["two.exe", "b".repeat(64)]]);
});

/** A GitHub that serves one release with the given files (name → bytes) and a SHA256SUMS of `sums`. */
function github(files: Record<string, string>, sums: Record<string, string> | null, status = 200): Fetch {
  const assets = [...Object.keys(files).map(asset), ...(sums ? [asset("SHA256SUMS-linux.txt")] : [])];
  return async (url) => {
    const body = (text: string) => ({ ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer });
    if (url === `${RELEASES}/latest` || url.startsWith(`${RELEASES}/tags/`)) {
      return status === 200 ? body(JSON.stringify({ tag_name: "desktop-v0.2.0", assets })) : { ...body("{}"), ok: false, status };
    }
    const name = url.slice("https://dl/".length);
    if (name === "SHA256SUMS-linux.txt") return body(Object.entries(sums ?? {}).map(([n, h]) => `${h}  ${n}`).join("\n"));
    return name in files ? body(files[name]!) : { ...body(""), ok: false, status: 404 };
  };
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

test("downloads the installer for this machine when its checksum matches; an AppImage is made executable", async () => {
  const dir = tempDir();
  const name = "agent-os-nexo_0.2.0_amd64.AppImage";
  const got = await downloadDesktop({ dir, platform: "linux", arch: "x64", fetchImpl: github({ [name]: "ELF" }, { [name]: sha("ELF") }) });
  assert.equal(got.file, join(dir, name));
  assert.equal(readFileSync(got.file, "utf8"), "ELF");
  assert.equal(got.version, "desktop-v0.2.0");
  assert.match(got.hint, /AppImage needs no install/);
  if (process.platform !== "win32") assert.ok(statSync(got.file).mode & 0o100, "executable");
  const mac = await downloadDesktop({ dir, platform: "darwin", arch: "arm64", tag: "desktop-v0.2.0", fetchImpl: github({ "a_aarch64.dmg": "dmg" }, { "a_aarch64.dmg": sha("dmg") }) });
  assert.match(mac.hint, /^Open it: open/);
  const win = await downloadDesktop({ dir, platform: "win32", arch: "x64", fetchImpl: github({ "a_x64-setup.exe": "MZ" }, { "a_x64-setup.exe": sha("MZ") }) });
  assert.match(win.hint, /Run the installer/);
});

test("refuses without checksums, with a wrong one, without an asset for this machine, or without a release", async () => {
  const dir = tempDir();
  const name = "agent-os-nexo_0.2.0_amd64.AppImage";
  await assert.rejects(downloadDesktop({ dir, platform: "linux", arch: "x64", fetchImpl: github({ [name]: "ELF" }, null) }), /no SHA256SUMS/);
  await assert.rejects(downloadDesktop({ dir, platform: "linux", arch: "x64", fetchImpl: github({ [name]: "EVIL" }, { [name]: sha("ELF") }) }), /does not match its checksum.*Not saved/);
  assert.ok(!existsSync(join(dir, name)), "a mismatching download is never written");
  await assert.rejects(downloadDesktop({ dir, platform: "linux", arch: "x64", fetchImpl: github({ [name]: "ELF" }, { other: sha("x") }) }), /not in the release's checksums/);
  await assert.rejects(downloadDesktop({ dir, platform: "win32", arch: "arm64", fetchImpl: github({ [name]: "ELF" }, { [name]: sha("ELF") }) }), /no installer for win32-arm64/);
  await assert.rejects(downloadDesktop({ dir, platform: "linux", arch: "x64", fetchImpl: github({}, {}, 404) }), /No desktop release published yet/);
  await assert.rejects(downloadDesktop({ dir, platform: "linux", arch: "x64", fetchImpl: github({}, {}, 500) }), /GitHub answered 500/);
  const missing = github({ [name]: "ELF" }, { [name]: sha("ELF") });
  const broken: Fetch = async (url, init) => (url.endsWith(".AppImage") ? { ...(await missing(url, init)), ok: false, status: 502 } : missing(url, init));
  await assert.rejects(downloadDesktop({ dir, platform: "linux", arch: "x64", fetchImpl: broken }), /Download of .* failed \(502\)/);
});

test("nexo os desktop saves into os/desktop and says how to install it", async () => {
  const root = await freshEnv("claude");
  const real = osDeps.downloadDesktop;
  osDeps.downloadDesktop = async (o) => ({ file: join(o.dir, "x.AppImage"), sha256: "f".repeat(64), version: o.tag ?? "latest", hint: "Run it." });
  try {
    assert.equal(await os("desktop", "desktop-v1", { root }), `Downloaded agent-os-nexo desktop desktop-v1 → ${join(root, "os", "desktop", "x.AppImage")}\nSHA-256 ${"f".repeat(64)} (matches the release).\nRun it.`);
  } finally {
    osDeps.downloadDesktop = real;
  }
});
