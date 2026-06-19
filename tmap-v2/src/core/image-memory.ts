// Image Memory Layer (TMAP steps 6-9) — persists what the pipeline learned about
// an image so later questions are answered WITHOUT re-analyzing it.
//
// Three layers, best-effort and non-blocking (like core/memory.ts):
//   - Chat session cache   : in-process Map, warm within a running server
//   - Temporary database   : Supabase `image_memories` (auto-expires after 30 days,
//                            deduped by imageHash) — survives cold starts
//   - File fallback        : per-user JSON when Supabase isn't configured
//
// Retrieval ranks stored memories against a user message (token overlap over
// summaries + OCR text + entities), so /v1/orchestrate can inject the relevant
// image knowledge into the prompt automatically (step 10).

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ImageUnderstanding } from './image-pipeline.js';

export interface ImageMemoryRecord {
  id: string;
  userId: string;
  imageHash: string;
  mimeType: string;
  shortSummary: string;
  detailedSummary: string;
  reusableContext: string;
  ocrText: string;
  entities: string[];
  keyPoints: string[];
  scene: string;
  createdAt: string;
  expiresAt: string;
}

const TTL_DAYS = Number(process.env.IMAGE_MEMORY_TTL_DAYS || 30);
const MAX_PER_USER = 200;

// ── Chat-session cache (in-process, warm within a server instance) ─────────────
const chatCache = new Map<string, ImageMemoryRecord[]>();

function cachePut(rec: ImageMemoryRecord): void {
  const list = chatCache.get(rec.userId) ?? [];
  const next = [rec, ...list.filter((r) => r.imageHash !== rec.imageHash)].slice(0, MAX_PER_USER);
  chatCache.set(rec.userId, next);
}
function cacheGet(userId: string): ImageMemoryRecord[] {
  return (chatCache.get(userId) ?? []).filter((r) => !isExpired(r));
}

// ── Supabase backend ───────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function rowToRecord(r: Record<string, unknown>): ImageMemoryRecord {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    imageHash: String(r.image_hash),
    mimeType: String(r.mime_type ?? ''),
    shortSummary: String(r.short_summary ?? ''),
    detailedSummary: String(r.detailed_summary ?? ''),
    reusableContext: String(r.reusable_context ?? ''),
    ocrText: String(r.ocr_text ?? ''),
    entities: Array.isArray(r.entities) ? (r.entities as string[]) : [],
    keyPoints: Array.isArray(r.key_points) ? (r.key_points as string[]) : [],
    scene: String(r.scene ?? ''),
    createdAt: String(r.created_at ?? ''),
    expiresAt: String(r.expires_at ?? ''),
  };
}
function recordToRow(rec: ImageMemoryRecord): Record<string, unknown> {
  return {
    id: rec.id, user_id: rec.userId, image_hash: rec.imageHash, mime_type: rec.mimeType,
    short_summary: rec.shortSummary, detailed_summary: rec.detailedSummary,
    reusable_context: rec.reusableContext, ocr_text: rec.ocrText,
    entities: rec.entities, key_points: rec.keyPoints, scene: rec.scene,
    created_at: rec.createdAt, expires_at: rec.expiresAt,
  };
}

// ── File fallback (per user) ────────────────────────────────────────────────────
function memoryDir(): string {
  return process.env.CGNTX_MEMORY_DIR
    ?? (process.env.VERCEL ? '/tmp/cgntx-memory' : join(process.cwd(), '.coagentix-server', 'memory'));
}
function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'default';
}
function filePath(userId: string): string {
  return join(memoryDir(), 'images_' + sanitize(userId) + '.json');
}
function loadFile(userId: string): ImageMemoryRecord[] {
  const p = filePath(userId);
  if (!existsSync(p)) return [];
  try {
    const arr = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(arr) ? (arr as ImageMemoryRecord[]) : [];
  } catch {
    return [];
  }
}
function saveFile(userId: string, records: ImageMemoryRecord[]): void {
  mkdirSync(memoryDir(), { recursive: true });
  writeFileSync(filePath(userId), JSON.stringify(records.slice(0, MAX_PER_USER), null, 2), 'utf8');
}

// ── Public API ──────────────────────────────────────────────────────────────────

function isExpired(rec: ImageMemoryRecord): boolean {
  return Boolean(rec.expiresAt) && Date.parse(rec.expiresAt) < Date.now();
}

/** Build a memory record from a completed pipeline run. */
export function toRecord(userId: string, u: ImageUnderstanding): ImageMemoryRecord {
  const now = Date.now();
  return {
    id: randomUUID(),
    userId,
    imageHash: u.processed.imageHash,
    mimeType: u.processed.mimeType,
    shortSummary: u.reusable.shortSummary,
    detailedSummary: u.reusable.detailedSummary,
    reusableContext: u.reusable.reusablePromptContext,
    ocrText: u.vision.rawText,
    entities: u.context.entities,
    keyPoints: u.context.keyPoints,
    scene: u.vision.scene,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_DAYS * 86_400_000).toISOString(),
  };
}

/** Look up a previously-analyzed image by content hash (duplicate detection). */
export async function findImageByHash(userId: string, imageHash: string): Promise<ImageMemoryRecord | undefined> {
  const cached = cacheGet(userId).find((r) => r.imageHash === imageHash);
  if (cached) return cached;

  if (useSupabase) {
    try {
      const res = await sb(
        `image_memories?user_id=eq.${encodeURIComponent(userId)}&image_hash=eq.${encodeURIComponent(imageHash)}&select=*&limit=1`,
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<Record<string, unknown>>;
        const rec = rows[0] ? rowToRecord(rows[0]) : undefined;
        if (rec && !isExpired(rec)) { cachePut(rec); return rec; }
        return undefined;
      }
    } catch { /* fall through to file */ }
  }
  const rec = loadFile(userId).find((r) => r.imageHash === imageHash && !isExpired(r));
  if (rec) cachePut(rec);
  return rec;
}

/** Persist a record across all layers, deduped by (userId, imageHash). */
export async function storeImageMemory(rec: ImageMemoryRecord): Promise<ImageMemoryRecord> {
  cachePut(rec);

  if (useSupabase) {
    try {
      const res = await sb('image_memories?on_conflict=user_id,image_hash', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(recordToRow(rec)),
      });
      if (res.ok) return rec;
    } catch { /* fall through to file */ }
  }
  const all = loadFile(rec.userId).filter((r) => r.imageHash !== rec.imageHash && !isExpired(r));
  saveFile(rec.userId, [rec, ...all]);
  return rec;
}

/** All non-expired records for a user (cache + persistent, deduped). */
export async function listImageMemories(userId: string, limit = MAX_PER_USER): Promise<ImageMemoryRecord[]> {
  let persistent: ImageMemoryRecord[] = [];
  if (useSupabase) {
    try {
      const res = await sb(
        `image_memories?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${MAX_PER_USER}&select=*`,
      );
      if (res.ok) persistent = ((await res.json()) as Array<Record<string, unknown>>).map(rowToRecord);
    } catch { /* fall through to file */ }
  }
  if (!persistent.length) persistent = loadFile(userId);

  const merged = new Map<string, ImageMemoryRecord>();
  for (const r of [...cacheGet(userId), ...persistent]) {
    if (isExpired(r)) continue;
    if (!merged.has(r.imageHash)) merged.set(r.imageHash, r);
  }
  return [...merged.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'why',
  'are', 'was', 'has', 'can', 'does', 'image', 'picture', 'photo', 'รูป', 'ภาพ',
]);
function tokenize(s: string): string[] {
  return (s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9฀-๿一-鿿぀-ヿ가-힯]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface RankedImageMemory {
  record: ImageMemoryRecord;
  score: number;
}

/** Rank a user's image memories by relevance to a query (token overlap). */
export async function searchImageMemories(
  userId: string, query: string, k = 3,
): Promise<RankedImageMemory[]> {
  const qTerms = new Set(tokenize(query));
  if (!qTerms.size) return [];

  const records = await listImageMemories(userId);
  const ranked: RankedImageMemory[] = [];
  for (const rec of records) {
    const hay = [rec.shortSummary, rec.detailedSummary, rec.ocrText, rec.scene,
      rec.entities.join(' '), rec.keyPoints.join(' ')].join(' ');
    const docTerms = tokenize(hay);
    if (!docTerms.length) continue;
    const docSet = new Set(docTerms);
    let overlap = 0;
    for (const t of qTerms) if (docSet.has(t)) overlap++;
    if (!overlap) continue;
    // recency tiebreaker so a fresh, equally-relevant image wins
    const ageDays = (Date.now() - Date.parse(rec.createdAt)) / 86_400_000;
    const score = overlap + Math.max(0, 0.5 - ageDays / 60);
    ranked.push({ record: rec, score: Math.round(score * 1000) / 1000 });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, k);
}

/** Render relevant image memories as a context block for prompt injection (step 10). */
export function imageMemoriesToContext(ranked: RankedImageMemory[]): string {
  if (!ranked.length) return '';
  const lines: string[] = ['## Image Memory (from images analyzed earlier — answer from this without re-reading)'];
  for (const { record } of ranked) {
    lines.push(`- ${record.shortSummary || record.detailedSummary.slice(0, 120)}`);
    if (record.reusableContext) lines.push(`  ${record.reusableContext.replace(/\n+/g, ' ').slice(0, 600)}`);
  }
  return lines.join('\n');
}

/** Remove all image memories for a user (across layers). */
export async function clearImageMemories(userId: string): Promise<void> {
  chatCache.delete(userId);
  if (useSupabase) {
    try { await sb(`image_memories?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' }); }
    catch { /* best-effort */ }
  }
  const p = filePath(userId);
  if (existsSync(p)) unlinkSync(p);
}

/** Delete expired rows (TTL housekeeping). Safe to call opportunistically. */
export async function purgeExpiredImageMemories(userId?: string): Promise<void> {
  const nowIso = new Date().toISOString();
  if (useSupabase) {
    try {
      const filter = userId ? `&user_id=eq.${encodeURIComponent(userId)}` : '';
      await sb(`image_memories?expires_at=lt.${encodeURIComponent(nowIso)}${filter}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
  }
  if (userId) {
    const kept = loadFile(userId).filter((r) => !isExpired(r));
    if (existsSync(filePath(userId))) saveFile(userId, kept);
  }
}
