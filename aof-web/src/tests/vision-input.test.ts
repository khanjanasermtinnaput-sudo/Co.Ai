import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAttachments, appendTextBlocks } from "@/lib/server/vision-input.js";

// ── helpers to build fake raw bytes with correct magic-byte signatures ──────

function pngDataUrl(): string {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([1, 2, 3, 4])]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
function jpegDataUrl(): string {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([1, 2, 3, 4])]);
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
function pdfDataUrl(): string {
  const bytes = Buffer.from("%PDF-1.4\n%fake pdf body", "ascii");
  return `data:application/pdf;base64,${bytes.toString("base64")}`;
}
function notAnImageDataUrl(): string {
  return `data:image/png;base64,${Buffer.from("just some text, not a real image").toString("base64")}`;
}

// ── decodeAttachments: images ────────────────────────────────────────────────

test("decodes a valid PNG image attachment into base64 + real media type", () => {
  const out = decodeAttachments([{ kind: "image", dataUrl: pngDataUrl() }]);
  assert.equal(out.images.length, 1);
  assert.equal(out.images[0].mediaType, "image/png");
  assert.equal(out.documents.length, 0);
});

test("decodes a valid JPEG image attachment", () => {
  const out = decodeAttachments([{ kind: "image", dataUrl: jpegDataUrl() }]);
  assert.equal(out.images.length, 1);
  assert.equal(out.images[0].mediaType, "image/jpeg");
});

test("rejects an image whose bytes don't match any known magic number", () => {
  const out = decodeAttachments([{ kind: "image", dataUrl: notAnImageDataUrl() }]);
  assert.equal(out.images.length, 0);
});

test("rejects malformed base64 without throwing", () => {
  const out = decodeAttachments([{ kind: "image", dataUrl: "data:image/png;base64,%%%not-base64%%%" }]);
  assert.equal(out.images.length, 0);
});

test("rejects an image over the byte-size cap", () => {
  const prev = process.env.IMAGE_MAX_BYTES;
  process.env.IMAGE_MAX_BYTES = "4"; // smaller than the 8-byte test PNG
  try {
    const out = decodeAttachments([{ kind: "image", dataUrl: pngDataUrl() }]);
    assert.equal(out.images.length, 0);
  } finally {
    if (prev === undefined) delete process.env.IMAGE_MAX_BYTES;
    else process.env.IMAGE_MAX_BYTES = prev;
  }
});

// ── decodeAttachments: PDFs ──────────────────────────────────────────────────

test("decodes a valid PDF attachment", () => {
  const out = decodeAttachments([{ kind: "pdf", dataUrl: pdfDataUrl(), name: "report.pdf" }]);
  assert.equal(out.documents.length, 1);
  assert.equal(out.documents[0].mediaType, "application/pdf");
  assert.equal(out.documents[0].name, "report.pdf");
});

test("rejects a 'pdf' attachment whose bytes lack the %PDF- signature", () => {
  const bytes = Buffer.from("not actually a pdf");
  const out = decodeAttachments([{ kind: "pdf", dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}` }]);
  assert.equal(out.documents.length, 0);
});

// ── decodeAttachments: text (code/document) ─────────────────────────────────

test("passes through code/document text attachments", () => {
  const out = decodeAttachments([{ kind: "code", name: "app.ts", text: "export const x = 1;" }]);
  assert.equal(out.textBlocks.length, 1);
  assert.equal(out.textBlocks[0].name, "app.ts");
  assert.equal(out.textBlocks[0].text, "export const x = 1;");
});

test("drops a text attachment with empty/whitespace-only text", () => {
  const out = decodeAttachments([{ kind: "document", name: "empty.md", text: "   " }]);
  assert.equal(out.textBlocks.length, 0);
});

// ── decodeAttachments: caps + malformed input ────────────────────────────────

test("caps the number of attachments processed", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ kind: "code", name: `f${i}.ts`, text: `// ${i}` }));
  const out = decodeAttachments(many);
  assert.ok(out.textBlocks.length <= 6);
});

test("never throws on garbage input", () => {
  assert.doesNotThrow(() => decodeAttachments(undefined));
  assert.doesNotThrow(() => decodeAttachments([]));
  // @ts-expect-error deliberately malformed for the runtime guard
  assert.doesNotThrow(() => decodeAttachments([null, 42, "oops", {}]));
});

// ── appendTextBlocks ─────────────────────────────────────────────────────────

test("appendTextBlocks leaves the message untouched when there are no text blocks", () => {
  assert.equal(appendTextBlocks("hello", []), "hello");
});

test("appendTextBlocks fences file content onto the message", () => {
  const out = appendTextBlocks("look at this", [{ name: "a.ts", text: "const x = 1;" }]);
  assert.match(out, /look at this/);
  assert.match(out, /Attached file "a\.ts"/);
  assert.match(out, /const x = 1;/);
});

test("appendTextBlocks with an empty message still renders the file content (image/PDF-less, text-only turn)", () => {
  const out = appendTextBlocks("", [{ name: "a.ts", text: "const x = 1;" }]);
  assert.match(out, /a\.ts/);
  assert.doesNotMatch(out, /^\n\n/);
});
