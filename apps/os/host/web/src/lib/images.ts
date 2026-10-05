// Images people attach (chat uploads, visual-bug screenshots): downscaled in the browser before they are sent.
import { t } from "../i18n";

const MAX_EDGE = 1568; // beyond this the API downsizes anyway — shrink first, save tokens and upload time
const MAX_BYTES = 3.5 * 1024 * 1024;

/** Downscales an image in the browser before it is uploaded (and, for chat images, sent to the agent). */
export async function prepareImage(file: Blob): Promise<Blob> {
  const ok = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  if (ok && scale === 1 && file.size <= MAX_BYTES) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!out) throw new Error(t("Could not process the image"));
  return out.size > MAX_BYTES && type === "image/png" ? ((await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88))) ?? out) : out;
}
