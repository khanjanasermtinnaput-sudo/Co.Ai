// ── Multimodal attachment helpers ─────────────────────────────────────────────
// Detect file kinds, decode them for preview/analysis, and describe accepted
// types. Image bytes become a data: URL (so they render inline); code & text
// files are decoded to a string the mock/analysis layer can reason over.

import type { Attachment, AttachmentKind } from "./types";
import { uid } from "./utils";

/** Source-code extensions Co.AI can read & analyse (see spec "Code File Support"). */
export const CODE_EXTENSIONS = [
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "java",
  "cpp",
  "c",
  "h",
  "hpp",
  "html",
  "css",
  "json",
  "go",
  "rs",
  "rb",
  "php",
  "sql",
  "sh",
  "yml",
  "yaml",
  "md",
] as const;

/** `accept` attribute values for the two upload buttons. */
export const ACCEPT = {
  image: "image/*",
  file: CODE_EXTENSIONS.map((e) => `.${e}`).join(","),
} as const;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Classify a file into one of the multimodal kinds. */
export function classifyFile(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if ((CODE_EXTENSIONS as readonly string[]).includes(extOf(file.name))) return "code";
  return "document";
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ── Image auto-compression ─────────────────────────────────────────────────
// Large phone photos/screenshots would otherwise eat most of a turn's
// dataUrl budget (route.ts caps the raw JSON body; vision-input.ts's
// IMAGE_MAX_BYTES is the server's separate 10 MB hard cap on the DECODED
// bytes). Anything over 1 MB is re-encoded client-side before it's ever
// turned into a dataUrl, rather than sent as-is and hoping it clears the
// server cap.
const IMAGE_COMPRESS_THRESHOLD_BYTES = 1024 * 1024; // 1 MB
// Leave headroom under the threshold so re-encoding variance can't creep
// the "compressed" result back over 1 MB.
const IMAGE_COMPRESS_TARGET_BYTES = Math.round(0.95 * IMAGE_COMPRESS_THRESHOLD_BYTES);
const MIN_JPEG_QUALITY = 0.4;
const MAX_COMPRESS_ATTEMPTS = 8;

type Drawable = ImageBitmap | HTMLImageElement;

function drawableSize(d: Drawable): { width: number; height: number } {
  return d instanceof HTMLImageElement
    ? { width: d.naturalWidth, height: d.naturalHeight }
    : { width: d.width, height: d.height };
}

/** Decode a File into something <canvas> can draw. Prefers createImageBitmap
 *  (off-main-thread decode); falls back to an <img> element for browsers/
 *  formats where that throws. */
async function loadDrawable(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * Re-encode an image under IMAGE_COMPRESS_THRESHOLD_BYTES. Alternates JPEG
 * quality steps and dimension downscaling; a PNG/GIF source (which may carry
 * transparency) is tried as PNG first — the quality argument has no effect
 * there, so a couple of dimension shrinks are given before falling back to
 * JPEG, which loses transparency but reliably keeps shrinking.
 *
 * Best-effort: if every attempt is undecodable or `toBlob` unavailable, the
 * original file is returned unchanged — vision-input.ts's server-side
 * IMAGE_MAX_BYTES (10 MB) is the real hard cap this exists to stay well
 * under, not a guarantee this function itself enforces.
 */
async function compressImage(file: File): Promise<{ blob: Blob; mime: string }> {
  const original = { blob: file as Blob, mime: file.type || "image/jpeg" };
  if (file.size <= IMAGE_COMPRESS_THRESHOLD_BYTES) return original;

  let drawable: Drawable;
  try {
    drawable = await loadDrawable(file);
  } catch {
    return original;
  }

  try {
    let { width, height } = drawableSize(drawable);
    if (!width || !height) return original;

    let mime = file.type === "image/png" || file.type === "image/gif" ? "image/png" : "image/jpeg";
    let quality = 0.9;
    let best: { blob: Blob; mime: string } | null = null;

    for (let attempt = 0; attempt < MAX_COMPRESS_ATTEMPTS; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, mime, mime === "image/jpeg" ? quality : undefined);
      if (!blob) break;
      if (!best || blob.size < best.blob.size) best = { blob, mime };
      if (blob.size <= IMAGE_COMPRESS_TARGET_BYTES) return { blob, mime };

      if (mime === "image/png" && attempt >= 1) {
        // PNG alone isn't shrinking fast enough — accept losing transparency.
        mime = "image/jpeg";
        quality = 0.85;
        continue;
      }
      if (mime === "image/jpeg" && quality > MIN_JPEG_QUALITY) {
        quality = Math.max(MIN_JPEG_QUALITY, quality - 0.15);
      } else {
        width *= 0.8;
        height *= 0.8;
      }
    }

    // Every attempt stayed over target — ship the smallest one we produced
    // rather than the (larger) original.
    return best && best.blob.size < file.size ? best : original;
  } finally {
    if (drawable instanceof ImageBitmap) drawable.close();
  }
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Read a browser File into an Attachment, decoding it appropriately by kind. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const kind = classifyFile(file);
  const base: Attachment = {
    id: uid("att"),
    kind,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
  try {
    if (kind === "image") {
      const { blob, mime } = await compressImage(file);
      base.dataUrl = await readAsDataUrl(blob);
      base.mime = mime;
      base.size = blob.size;
    } else if (kind === "code" || kind === "document") {
      // Cap decoded text so we never blow up memory on a huge file.
      base.text = (await readAsText(file)).slice(0, 20_000);
    }
  } catch {
    /* keep the attachment even if decoding fails — metadata is still useful */
  }
  return base;
}

/** Human-friendly file size, e.g. "12 KB", "3.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_LABEL: Record<AttachmentKind, string> = {
  image: "Image",
  code: "Code",
  document: "Document",
};

export function kindLabel(kind: AttachmentKind): string {
  return KIND_LABEL[kind];
}
