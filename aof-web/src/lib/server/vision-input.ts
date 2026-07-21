// ── Vision/document input validation ─────────────────────────────────────────
// Decodes and validates the attachments a CoChat turn sends alongside its
// message: images (any provider's vision path) and code/document text files
// (folded into the message as fenced text — see appendTextBlocks below).
// Magic-byte detection re-verifies the claimed type rather than trusting the
// browser-supplied MIME string, the same discipline as
// tmap-v2/src/core/image-pipeline.ts's processImage() — copied in miniature
// here since aof-web and tmap-v2 share no workspace (same precedent as
// crypto.ts's two independent copies).

// Read fresh per call (like ai-providers.ts's firstTokenDeadlineMs()) rather
// than frozen at module load, so both an operator's real env override and a
// test's env mutation take effect.
function maxImageBytes(): number {
  const v = Number(process.env.IMAGE_MAX_BYTES);
  return Number.isFinite(v) && v > 0 ? v : 10 * 1024 * 1024; // 10 MB
}
const MAX_ATTACHMENTS = 6;
const MAX_TEXT_CHARS = 20_000;

export interface RawAttachment {
  kind?: string;
  mime?: string;
  name?: string;
  dataUrl?: string;
  text?: string;
}

export interface DecodedImage {
  mediaType: string; // image/png | image/jpeg | image/webp | image/gif
  data: string; // base64, no data: prefix
}

export interface DecodedTextBlock {
  name: string;
  text: string;
}

export interface DecodedAttachments {
  images: DecodedImage[];
  textBlocks: DecodedTextBlock[];
}

function detectImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function decodeDataUrl(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const b64 = trimmed.startsWith("data:") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  try {
    const bytes = Buffer.from(b64, "base64");
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

/** Validate and decode a turn's raw attachments into provider-ready shapes.
 *  Never throws — a malformed/oversized/unrecognized attachment is silently
 *  dropped (the turn still proceeds on whatever text the user typed) rather
 *  than failing the whole request. */
export function decodeAttachments(raw: RawAttachment[] | undefined): DecodedAttachments {
  const images: DecodedImage[] = [];
  const textBlocks: DecodedTextBlock[] = [];

  if (!Array.isArray(raw)) return { images, textBlocks };

  for (const att of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!att || typeof att !== "object") continue;

    if (att.kind === "image" && att.dataUrl) {
      const bytes = decodeDataUrl(att.dataUrl);
      if (!bytes || bytes.length > maxImageBytes()) continue;
      const mediaType = detectImageMime(bytes);
      if (!mediaType) continue;
      images.push({ mediaType, data: bytes.toString("base64") });
      continue;
    }

    if ((att.kind === "code" || att.kind === "document") && typeof att.text === "string" && att.text.trim()) {
      textBlocks.push({ name: att.name || "attachment", text: att.text.slice(0, MAX_TEXT_CHARS) });
    }
  }

  return { images, textBlocks };
}

/** Render decoded text-file attachments as a fenced block appended to the
 *  user's message — the one shape every provider (not just vision-capable
 *  ones) can read, since it travels as plain message text. */
export function appendTextBlocks(message: string, textBlocks: DecodedTextBlock[]): string {
  if (!textBlocks.length) return message;
  const rendered = textBlocks
    .map((b) => `Attached file "${b.name}":\n\`\`\`\n${b.text}\n\`\`\``)
    .join("\n\n");
  return message ? `${message}\n\n${rendered}` : rendered;
}
