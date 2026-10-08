// The desktop app's installer for this machine, from the project's GitHub releases (built per OS by
// .github/workflows/release-desktop.yml): pick the asset for this OS and CPU, download it, check its SHA-256 against
// the release's checksum files. Installing it stays the user's step — it is their system.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "./fsx.ts";

export const RELEASES = "https://api.github.com/repos/NexoDigital-Lab/Agent-Os-Nexo/releases";

export interface Asset {
  name: string;
  browser_download_url: string;
}

/** Tauri's bundle names per OS/CPU: an AppImage on Linux (any distro), a dmg on macOS, the NSIS setup on Windows. */
const PATTERNS: Record<string, Record<string, RegExp>> = {
  linux: { x64: /_amd64\.AppImage$/, arm64: /_aarch64\.AppImage$/ },
  darwin: { x64: /_x64\.dmg$/, arm64: /_aarch64\.dmg$/ },
  win32: { x64: /_x64-setup\.exe$/, arm64: /_arm64-setup\.exe$/ },
};

export function pickAsset(assets: Asset[], platform: string, arch: string): Asset | null {
  const pattern = PATTERNS[platform]?.[arch];
  return pattern ? assets.find((a) => pattern.test(a.name)) ?? null : null;
}

/** `sha256sum` output (`<hex>  <name>`, possibly `*name`) from every SHA256SUMS* asset, merged. */
export function parseSums(texts: string[]): Map<string, string> {
  const sums = new Map<string, string>();
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
      if (m?.[1] && m[2]) sums.set(m[2].trim(), m[1].toLowerCase());
    }
  }
  return sums;
}

const HINTS: Record<string, (file: string) => string> = {
  linux: (f) => `Run it: ${f}  (an AppImage needs no install; keep it where you like)`,
  darwin: (f) => `Open it: open "${f}" — then drag agent-os-nexo to Applications`,
  win32: (f) => `Run the installer: "${f}" — then \`nexo os install\` (or a new build) creates the desktop shortcut`,
};

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Downloads the installer for this machine into `dir`; refuses when the checksum is missing or does not match. */
export async function downloadDesktop(opts: { dir: string; platform?: string; arch?: string; tag?: string; fetchImpl?: Fetch }): Promise<{ file: string; sha256: string; version: string; hint: string }> {
  const { dir, platform = process.platform, arch = process.arch, tag, fetchImpl = fetch as unknown as Fetch } = opts;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "nexo-cli" };
  const res = await fetchImpl(tag ? `${RELEASES}/tags/${encodeURIComponent(tag)}` : `${RELEASES}/latest`, { headers });
  if (!res.ok) throw new Error(res.status === 404 ? "No desktop release published yet." : `GitHub answered ${res.status} for the releases.`);
  const release = (await res.json()) as { tag_name?: string; assets?: Asset[] };
  const assets = release.assets ?? [];
  const asset = pickAsset(assets, platform, arch);
  if (!asset) throw new Error(`Release ${release.tag_name ?? "?"} has no installer for ${platform}-${arch}.`);
  const sumFiles = assets.filter((a) => /^SHA256SUMS/i.test(a.name));
  if (!sumFiles.length) throw new Error(`Release ${release.tag_name ?? "?"} has no SHA256SUMS: not downloading an unverifiable installer.`);
  const sums = parseSums(await Promise.all(sumFiles.map(async (a) => (await fetchImpl(a.browser_download_url, { headers })).text())));
  const expected = sums.get(asset.name);
  if (!expected) throw new Error(`${asset.name} is not in the release's checksums.`);
  const bin = await fetchImpl(asset.browser_download_url, { headers });
  if (!bin.ok) throw new Error(`Download of ${asset.name} failed (${bin.status}).`);
  const data = Buffer.from(await bin.arrayBuffer());
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (sha256 !== expected) throw new Error(`${asset.name} does not match its checksum (got ${sha256.slice(0, 12)}…, expected ${expected.slice(0, 12)}…). Not saved.`);
  ensureDir(dir);
  const file = join(dir, asset.name);
  writeFileSync(file, data);
  if (platform !== "win32" && /\.AppImage$/.test(asset.name) && existsSync(file)) chmodSync(file, 0o755);
  return { file, sha256, version: release.tag_name ?? "", hint: (HINTS[platform] ?? ((f: string) => f))(file) };
}
