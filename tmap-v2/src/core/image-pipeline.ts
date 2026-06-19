// Image Understanding Pipeline (TMAP) — turns an uploaded image into reusable,
// text-based knowledge so future questions are answered WITHOUT re-reading it.
//
// Flow (see project workflow spec):
//   1. Image Processing  — validate, detect type, hash
//   2+3. Vision Read     — OCR (multi-language) + object/scene/UI/document analysis
//        (one multimodal call: the model reads the image once and returns
//         structured JSON — cheaper and more consistent than two image reads)
//   4. Context Extraction — summary, key points, entities, numbers, dates, actions
//   5. Prompt Engineering — short/detailed summary + reusable prompt context
//
// Steps 1 is pure Node (no API). Step 2+3 needs a vision-capable model. Steps 4+5
// are text-only and run through whatever LLMCall the caller injects (DARS-backed).

import { createHash } from 'node:crypto';
import { chat } from '../providers/client.js';
import { listVisionProvidersWith, type CredentialBag } from '../config.js';
import type { MultimodalMessage, LLMCall, ResolvedProvider } from '../types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProcessedImage {
  imageHash: string;       // sha256 of the raw bytes — the dedup key
  mimeType: string;        // image/png | image/jpeg | image/webp | image/gif
  byteLength: number;
  dataUrl: string;         // data:<mime>;base64,<...> — ready for a vision model
  uploadTime: string;      // ISO timestamp
}

export interface VisionRead {
  rawText: string;                 // OCR — all text found, any language
  detectedLanguages: string[];     // e.g. ['en','th']
  objects: string[];               // people, products, vehicles, buildings, …
  scene: string;                   // indoor | outdoor | office | website | …
  uiElements: string[];            // buttons/menus/cards/forms if a screenshot
  documentStructure: Record<string, unknown>; // title/headings/tables if a doc
  confidence: number;              // 0..1 self-reported
}

export interface ContextExtraction {
  summary: string;
  keyPoints: string[];
  entities: string[];
  importantNumbers: string[];
  importantDates: string[];
  actionItems: string[];
}

export interface ReusableContext {
  shortSummary: string;      // one line — for lists / chat memory
  detailedSummary: string;   // paragraph — for context injection
  reusablePromptContext: string; // model-ready knowledge block
}

export interface ImageUnderstanding {
  processed: ProcessedImage;
  vision: VisionRead;
  context: ContextExtraction;
  reusable: ReusableContext;
}

// Allowed types + magic-byte signatures. Keeps the pipeline dependency-free
// (no sharp/file-type) while rejecting non-images before we spend any tokens.
const MAX_IMAGE_BYTES = Number(process.env.IMAGE_MAX_BYTES || 10 * 1024 * 1024); // 10 MB

function detectMime(bytes: Buffer): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ── Step 1: Image Processing ───────────────────────────────────────────────────

export interface ImageInput {
  data: string;        // data URL ("data:image/png;base64,...") or raw base64
  mimeType?: string;   // optional hint; magic bytes win
}

/** Validate, detect type, hash. Throws a user-readable Error on bad input. */
export function processImage(input: ImageInput): ProcessedImage {
  const raw = (input.data || '').trim();
  if (!raw) throw new Error('image data is empty');

  const b64 = raw.startsWith('data:')
    ? raw.slice(raw.indexOf(',') + 1)
    : raw;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, 'base64');
  } catch {
    throw new Error('image data is not valid base64');
  }
  if (!bytes.length) throw new Error('decoded image is empty');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`image too large: ${bytes.length} bytes (max ${MAX_IMAGE_BYTES})`);
  }

  const mime = detectMime(bytes);
  if (!mime) throw new Error('unsupported image type (allowed: png, jpeg, webp, gif)');

  const imageHash = createHash('sha256').update(bytes).digest('hex');
  return {
    imageHash,
    mimeType: mime,
    byteLength: bytes.length,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    uploadTime: new Date().toISOString(),
  };
}

// ── Step 2+3: Vision Read (OCR + analysis in one multimodal call) ──────────────

const VISION_READ_SYS = `You are the Vision Agent in Coagentix — an expert image analyst and OCR engine.
Read the image completely and return ONLY a JSON object (no markdown, no preamble) with this exact shape:
{
  "rawText": "every piece of text you can read, verbatim, preserving line breaks, in ALL languages present (English, Thai, Chinese, Japanese, Korean, numbers, URLs, emails, table cells)",
  "detectedLanguages": ["ISO codes of languages found, e.g. en, th, zh, ja, ko"],
  "objects": ["notable objects/people/animals/vehicles/products/buildings"],
  "scene": "one of: indoor, outdoor, office, classroom, website, application, document, other — plus a short note",
  "uiElements": ["if a screenshot: buttons, menus, cards, forms, navigation, settings present"],
  "documentStructure": { "title": "", "headings": [], "tables": [], "diagrams": [] },
  "confidence": 0.0
}
If a field does not apply, use an empty string/array/object. Never invent text that is not visible.`;

export async function readImage(
  creds: CredentialBag,
  dataUrl: string,
  opts: { signal?: AbortSignal; userHint?: string } = {},
): Promise<VisionRead> {
  const candidates = listVisionProvidersWith(creds);

  const messages: MultimodalMessage[] = [
    { role: 'system', content: VISION_READ_SYS },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Analyze this image and return the structured JSON described above.'
            + (opts.userHint ? `\nUser context: ${opts.userHint}` : ''),
        },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ],
    },
  ];

  // No vision-capable key → mock provider produces a stub so the flow still works.
  if (!candidates.length) {
    const mock: ResolvedProvider = {
      role: 'planner', providerName: 'vision (mock)', baseURL: '', apiKey: '', model: 'mock', mode: 'mock',
    };
    return parseVisionRead(await chat(mock, messages, { temperature: 0.1, maxTokens: 2048, signal: opts.signal }));
  }

  let lastErr: Error | undefined;
  for (const provider of candidates) {
    try {
      const raw = await chat(provider, messages, { temperature: 0.1, maxTokens: 2048, signal: opts.signal });
      return parseVisionRead(raw);
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(`vision read failed on all providers: ${lastErr?.message ?? 'unknown error'}`);
}

function parseVisionRead(raw: string): VisionRead {
  const parsed = safeJson(raw);
  return {
    rawText: str(parsed.rawText),
    detectedLanguages: strList(parsed.detectedLanguages),
    objects: strList(parsed.objects),
    scene: str(parsed.scene),
    uiElements: strList(parsed.uiElements),
    documentStructure: isObject(parsed.documentStructure) ? parsed.documentStructure as Record<string, unknown> : {},
    confidence: clamp01(Number(parsed.confidence)),
  };
}

// ── Step 4: Context Extraction (text-only) ─────────────────────────────────────

const CONTEXT_EXTRACT_SYS = `You are the Context Extraction Agent in Coagentix.
Given the raw OCR text and visual analysis of an image, produce ONLY a JSON object:
{
  "summary": "2-3 sentence summary of what the image is and shows",
  "keyPoints": ["the most important facts a user might ask about later"],
  "entities": ["named people, products, companies, places, model names"],
  "importantNumbers": ["quotas, prices, counts, percentages with their labels"],
  "importantDates": ["dates/times found"],
  "actionItems": ["any tasks, warnings, or next steps implied"]
}
Write values in the SAME LANGUAGE as the image content. Be faithful — do not invent.`;

export async function extractContext(call: LLMCall, vision: VisionRead): Promise<ContextExtraction> {
  const payload = JSON.stringify({
    rawText: vision.rawText.slice(0, 8000),
    objects: vision.objects,
    scene: vision.scene,
    uiElements: vision.uiElements,
    documentStructure: vision.documentStructure,
  });

  const raw = await call([
    { role: 'system', content: CONTEXT_EXTRACT_SYS },
    { role: 'user', content: `Image analysis:\n${payload}` },
  ], { temperature: 0.2, maxTokens: 1200 });

  const parsed = safeJson(raw);
  return {
    summary: str(parsed.summary) || vision.rawText.slice(0, 200),
    keyPoints: strList(parsed.keyPoints),
    entities: strList(parsed.entities),
    importantNumbers: strList(parsed.importantNumbers),
    importantDates: strList(parsed.importantDates),
    actionItems: strList(parsed.actionItems),
  };
}

// ── Step 5: Prompt Engineering / reusable knowledge (text-only) ────────────────

const REUSABLE_SYS = `You are the Prompt Engineering Agent in Coagentix.
Turn the structured understanding of an image into reusable knowledge. Return ONLY JSON:
{
  "shortSummary": "one concise line describing the image (for a list view)",
  "detailedSummary": "a rich paragraph capturing everything important",
  "reusablePromptContext": "a compact knowledge block that can be injected into a future prompt so the assistant can answer questions about this image WITHOUT seeing it again. Include the key text, numbers, entities and structure."
}
Write in the SAME LANGUAGE as the image content.`;

export async function buildReusableContext(
  call: LLMCall, vision: VisionRead, context: ContextExtraction,
): Promise<ReusableContext> {
  const payload = JSON.stringify({ vision: { ...vision, rawText: vision.rawText.slice(0, 6000) }, context });

  const raw = await call([
    { role: 'system', content: REUSABLE_SYS },
    { role: 'user', content: `Structured understanding:\n${payload}` },
  ], { temperature: 0.3, maxTokens: 1200 });

  const parsed = safeJson(raw);
  return {
    shortSummary: str(parsed.shortSummary) || context.summary.slice(0, 120),
    detailedSummary: str(parsed.detailedSummary) || context.summary,
    reusablePromptContext: str(parsed.reusablePromptContext)
      || [context.summary, vision.rawText.slice(0, 1500)].filter(Boolean).join('\n'),
  };
}

// ── Orchestrator: run the whole pipeline ───────────────────────────────────────

export interface RunPipelineOpts {
  creds: CredentialBag;
  textCall: LLMCall;            // DARS-backed text agent for steps 4 & 5
  userHint?: string;           // optional user question/context for the read
  signal?: AbortSignal;
  onStep?: (step: string) => void;
}

export async function runImagePipeline(input: ImageInput, opts: RunPipelineOpts): Promise<ImageUnderstanding> {
  const step = (s: string) => opts.onStep?.(s);

  step('processing');
  const processed = processImage(input);

  step('reading');
  const vision = await readImage(opts.creds, processed.dataUrl, { signal: opts.signal, userHint: opts.userHint });

  step('extracting');
  const context = await extractContext(opts.textCall, vision);

  step('summarizing');
  const reusable = await buildReusableContext(opts.textCall, vision, context);

  step('done');
  return { processed, vision, context, reusable };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function safeJson(raw: string): Record<string, unknown> {
  if (!raw) return {};
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const v = JSON.parse(match[0]);
    return isObject(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim())).filter(Boolean).slice(0, 50);
}
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
