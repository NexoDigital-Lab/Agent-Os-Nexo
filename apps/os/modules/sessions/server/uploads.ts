// Per-tab temporary images: sent to Claude inline and kept on disk so it can re-Read them; deleted with the tab.
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { httpError } from "../../../host/server/http.ts";

let UPLOADS = "";

/** Where tabs keep their temporary images (.state/os/sessions/uploads). Set once at register. */
export function setUploadsDir(dir: string): void {
  UPLOADS = dir;
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([m, e]) => [e, m]));
const UPLOAD_NAME = /^img-\d+\.(png|jpg|gif|webp)$/;

export function saveUpload(id: string, data: Buffer, mime: string) {
  const ext = IMAGE_TYPES[mime];
  if (!ext) throw httpError(415, `Unsupported format: ${mime}`);
  const dir = path.join(UPLOADS, id);
  mkdirSync(dir, { recursive: true });
  const n = readdirSync(dir).length + 1;
  const name = `img-${Date.now()}${n}.${ext}`;
  writeFileSync(path.join(dir, name), data);
  return { name, url: `/api/tabs/${id}/uploads/${name}` };
}

/** Absolute path of a tab's upload, or null if the name isn't one we generated. */
export function uploadPath(id: string, name: string): string | null {
  if (!UPLOAD_NAME.test(name)) return null;
  const file = path.join(UPLOADS, id, name);
  return existsSync(file) ? file : null;
}

export function deleteUpload(id: string, name: string) {
  const file = uploadPath(id, name);
  if (file) rmSync(file);
}

/** One user message: image blocks first, then the text plus where the files live. */
export function userMessage(id: string, text: string, images: string[] = []): SDKUserMessage {
  const files = images.map((n) => uploadPath(id, n)).filter((f): f is string => !!f);
  if (!files.length) return { type: "user", parent_tool_use_id: null, message: { role: "user", content: text } };
  const note = `\n\n[${files.length} image(s) attached, saved temporarily at: ${files.join(", ")}]`;
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...files.map((f) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: MIME_BY_EXT[path.extname(f).slice(1)] as "image/png",
            data: readFileSync(f).toString("base64"),
          },
        })),
        { type: "text" as const, text: text + note },
      ],
    },
  };
}

export const dropUploads = (tab: string) => rmSync(path.join(UPLOADS, tab), { recursive: true, force: true });

/** On start: remove uploads of tabs that no longer exist. */
export function pruneUploads(alive: (tab: string) => boolean) {
  if (existsSync(UPLOADS)) for (const d of readdirSync(UPLOADS)) if (!alive(d)) dropUploads(d);
}
