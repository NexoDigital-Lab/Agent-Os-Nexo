// Reads one regular file out of a release archive (.tar.gz or .zip) in memory, with Node built-ins only.
// Nothing is extracted to disk by name: the caller writes the bytes where it wants, so a hostile archive cannot
// place files (`../`, links) anywhere.
import { gunzipSync, inflateRawSync } from "node:zlib";

/** The bytes of the regular file whose base name is `name`, at any depth; null when the archive has none. */
export function tarGzMember(archive: Buffer, name: string): Buffer | null {
  const tar = gunzipSync(archive);
  let longName: string | null = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from: number, len: number) => header.subarray(from, from + len).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = body.toString("utf8").replace(/\0.*$/s, ""); // GNU long name for the next entry
      continue;
    }
    const prefix = field(345, 155);
    const path = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    if ((type === "0" || type === "\0") && baseName(path) === name) return Buffer.from(body);
  }
  return null;
}

/** The bytes of the file whose base name is `name` in a zip (stored or deflated); null when absent. */
export function zipMember(archive: Buffer, name: string): Buffer | null {
  // End of central directory: the last "PK\x05\x06" (a comment may follow it).
  let eocd = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip archive.");
  const count = archive.readUInt16LE(eocd + 10);
  let at = archive.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error("Broken zip central directory.");
    const method = archive.readUInt16LE(at + 10);
    const compressed = archive.readUInt32LE(at + 20);
    const nameLen = archive.readUInt16LE(at + 28);
    const extraLen = archive.readUInt16LE(at + 30);
    const commentLen = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const path = archive.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/") || baseName(path) !== name) continue;
    if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error("Broken zip entry.");
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + compressed);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`Unsupported zip compression (${method}) for ${path}.`);
  }
  return null;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}
