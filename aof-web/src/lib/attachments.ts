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

/** `accept` attribute values for the three upload buttons. */
export const ACCEPT = {
  image: "image/*",
  pdf: "application/pdf,.pdf",
  file: CODE_EXTENSIONS.map((e) => `.${e}`).join(","),
} as const;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Classify a file into one of the multimodal kinds. */
export function classifyFile(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || extOf(file.name) === "pdf") return "pdf";
  if ((CODE_EXTENSIONS as readonly string[]).includes(extOf(file.name))) return "code";
  return "document";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
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
    if (kind === "image" || kind === "pdf") {
      base.dataUrl = await readAsDataUrl(file);
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
  pdf: "PDF",
  code: "Code",
  document: "Document",
};

export function kindLabel(kind: AttachmentKind): string {
  return KIND_LABEL[kind];
}
