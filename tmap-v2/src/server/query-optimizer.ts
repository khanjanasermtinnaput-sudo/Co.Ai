// Query optimization — cursor-based pagination, cached queries, N+1 detection,
// batch insert helpers, and query cost estimation for Supabase/file-store.

import { cacheKey, cacheGet, cacheSet, cacheDel } from './redis.js';
import { logger } from './logger.js';

// ── Cursor pagination ─────────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  total?: number;
}

export function encodeCursor(value: string | number): string {
  return Buffer.from(String(value)).toString('base64url');
}

export function decodeCursor(cursor: string): string {
  try { return Buffer.from(cursor, 'base64url').toString('utf8'); } catch { return ''; }
}

export function paginateCursor<T extends Record<string, unknown>>(
  items: T[],
  cursorField: keyof T,
  limit: number,
): Page<T> {
  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;
  const last    = page[page.length - 1];
  const first   = page[0];
  return {
    items:      page,
    nextCursor: hasMore && last ? encodeCursor(String(last[cursorField])) : null,
    prevCursor: first ? encodeCursor(String(first[cursorField])) : null,
  };
}

// ── Cached query wrapper ──────────────────────────────────────────────────────

export async function cachedQuery<T>(
  ns: string,
  params: Record<string, unknown>,
  fetcher: () => Promise<T>,
  ttlSec = 60,
): Promise<T> {
  const key = cacheKey(ns, stableHash(params));
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fetcher();
  await cacheSet(key, value, ttlSec);
  return value;
}

export async function invalidateQuery(ns: string, params: Record<string, unknown>): Promise<void> {
  const key = cacheKey(ns, stableHash(params));
  await cacheDel(key);
}

function stableHash(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj).sort().map((k) => `${k}=${JSON.stringify(obj[k])}`).join('&');
  return Buffer.from(sorted).toString('base64url').slice(0, 32);
}

// ── Query cost estimation ─────────────────────────────────────────────────────

export type QueryCostLevel = 'cheap' | 'medium' | 'expensive';

export interface QueryCostHint {
  level: QueryCostLevel;
  reason: string;
  suggestCache: boolean;
  cacheTtlSec?: number;
}

export function estimateQueryCost(opts: {
  hasFilters: boolean;
  limit?: number;
  hasJoin?: boolean;
  isAggregation?: boolean;
}): QueryCostHint {
  if (opts.isAggregation)
    return { level: 'expensive', reason: 'aggregation', suggestCache: true, cacheTtlSec: 300 };
  if (opts.hasJoin)
    return { level: 'medium',    reason: 'join',         suggestCache: true, cacheTtlSec: 60  };
  if (!opts.hasFilters)
    return { level: 'expensive', reason: 'full-scan',    suggestCache: true, cacheTtlSec: 120 };
  if ((opts.limit ?? 100) <= 10)
    return { level: 'cheap',     reason: 'filtered+small', suggestCache: false };
  return   { level: 'medium',    reason: 'filtered',     suggestCache: true, cacheTtlSec: 30  };
}

// ── N+1 detection ─────────────────────────────────────────────────────────────

const _queryLog: { table: string; ts: number }[] = [];
const N1_WINDOW_MS = 100;
const N1_THRESHOLD = 5;

export function recordQuery(table: string): void {
  const now = Date.now();
  _queryLog.push({ table, ts: now });
  if (_queryLog.length > 1_000) _queryLog.splice(0, _queryLog.length - 1_000);
  const recent = _queryLog.filter((q) => q.table === table && now - q.ts < N1_WINDOW_MS);
  if (recent.length >= N1_THRESHOLD) {
    logger.warn('n1_query_detected', { table, count: recent.length, windowMs: N1_WINDOW_MS });
  }
}

// ── Batch insert ──────────────────────────────────────────────────────────────

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function batchInsert<T>(
  items: T[],
  insertFn: (batch: T[]) => Promise<void>,
  batchSize = 100,
): Promise<{ inserted: number; errors: number }> {
  let inserted = 0;
  let errors   = 0;
  for (const chunk of chunkArray(items, batchSize)) {
    try   { await insertFn(chunk); inserted += chunk.length; }
    catch (e) {
      errors += chunk.length;
      logger.error('batch_insert_error', { error: (e as Error).message, size: chunk.length });
    }
  }
  return { inserted, errors };
}

// ── Offset pagination (simple) ────────────────────────────────────────────────

export function paginateOffset<T>(
  items: T[],
  page: number,
  pageSize: number,
): { items: T[]; page: number; pageSize: number; total: number; pages: number } {
  const total = items.length;
  const pages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageSize, total, pages };
}
