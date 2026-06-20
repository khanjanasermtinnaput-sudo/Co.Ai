// Lightweight file-based KV store — used by Phase 6 modules as a persistence
// fallback when Supabase is not configured. Each collection is a subdirectory
// under CGNTX_DATA_DIR; each record is a <id>.json file.
// Thread-safety note: single-process only. For multi-instance use, configure
// Supabase and use the Supabase client directly.

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  readdirSync, unlinkSync, renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const BASE_DIR: string = process.env.CGNTX_DATA_DIR
  ?? (process.env.VERCEL ? join(tmpdir(), 'cgntx-data') : '.coagentix-server/data');

function collectionDir(col: string): string {
  const dir = join(BASE_DIR, col);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Colons are invalid in Windows filenames; replace with double-dash for portability.
function safeId(id: string): string {
  return id.replace(/:/g, '--');
}

function recordPath(col: string, id: string): string {
  return join(collectionDir(col), `${safeId(id)}.json`);
}

export function fsGet<T>(collection: string, id: string): T | null {
  const p = recordPath(collection, id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return null; }
}

export function fsPut<T>(collection: string, id: string, value: T): void {
  const dir = collectionDir(collection);
  const tmp = join(dir, `.tmp-${randomUUID()}`);
  writeFileSync(tmp, JSON.stringify(value), 'utf8');
  renameSync(tmp, join(dir, `${safeId(id)}.json`));
}

export function fsDel(collection: string, id: string): boolean {
  const p = recordPath(collection, id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function fsList<T>(collection: string, filter?: (item: T) => boolean): T[] {
  const dir = collectionDir(collection);
  const results: T[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const f of entries) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try {
      const item = JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;
      if (!filter || filter(item)) results.push(item);
    } catch { /* skip corrupt files */ }
  }
  return results;
}

export function fsExists(collection: string, id: string): boolean {
  return existsSync(recordPath(collection, id));
}

export function fsCount(collection: string): number {
  try { return readdirSync(collectionDir(collection)).filter((f) => f.endsWith('.json')).length; } catch { return 0; }
}
