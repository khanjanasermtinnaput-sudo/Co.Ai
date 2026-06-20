// Developer API key management — long-lived keys for external integrations.
//
// Unlike session JWTs (7-day TTL, browser auth), developer keys:
//   • Never expire (until explicitly revoked).
//   • Are prefixed cgntx_sk_ so they're recognisable in logs.
//   • Carry a scope list (e.g. ['sandbox', 'run', 'usage:read']).
//   • Are stored as BLAKE2 hashes — the raw key is shown only once on creation.
//   • Support up to MAX_KEYS_PER_USER keys per user.
//
// Storage: Supabase `developer_keys` table when available; JSON file fallback.

import { randomBytes, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DevKeyScope =
  | 'sandbox:run'
  | 'sandbox:read'
  | 'usage:read'
  | 'sessions:read'
  | 'run'
  | 'chat'
  | 'keys:read'
  | '*';

export interface DeveloperKey {
  id:        string;
  userId:    string;
  name:      string;
  scopes:    DevKeyScope[];
  keyHash:   string;    // BLAKE2 hash of the raw key — never store the raw key
  prefix:    string;    // First 12 chars for display (cgntx_sk_xxx)
  createdAt: string;
  lastUsed:  string | null;
  revokedAt: string | null;
}

export interface CreateKeyResult {
  key:    DeveloperKey;
  rawKey: string;  // Shown ONCE — never stored
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KEY_PREFIX     = 'cgntx_sk_';
const MAX_KEYS_PER_USER = 10;
const VALID_SCOPES = new Set<DevKeyScope>([
  'sandbox:run', 'sandbox:read', 'usage:read', 'sessions:read',
  'run', 'chat', 'keys:read', '*',
]);

// ── Storage ───────────────────────────────────────────────────────────────────

const KEYS_DIR = process.env.DEV_KEYS_DIR
  ?? (process.env.VERCEL ? '/tmp/coagentix-devkeys' : join(process.cwd(), '.aof-server', 'devkeys'));
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function keysFile(userId: string): string {
  return join(KEYS_DIR, `${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function loadKeys(userId: string): DeveloperKey[] {
  const path = keysFile(userId);
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf8')) as DeveloperKey[]; }
  catch { return []; }
}

function saveKeys(userId: string, keys: DeveloperKey[]): void {
  const path = keysFile(userId);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(keys, null, 2), { encoding: 'utf8', mode: 0o600 });
}

// HMAC-SHA256 with the master key as salt — makes rainbow-table attacks
// against the stored hash infeasible even if the hash file is exfiltrated.
function hashKey(raw: string): string {
  const master = process.env.COAGENTIX_MASTER_KEY ?? process.env.AOF_MASTER_KEY ?? 'dev-fallback-key';
  return createHmac('sha256', master).update(raw).digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function sbFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY!,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    },
    signal: AbortSignal.timeout(5_000),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listDevKeys(userId: string): Promise<DeveloperKey[]> {
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const resp = await sbFetch(`/rest/v1/developer_keys?user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null&select=*`, {});
      if (resp.ok) {
        const rows = await resp.json() as Record<string, unknown>[];
        return rows.map(rowToKey);
      }
    } catch (e) {
      logger.warn('devkeys_supabase_list_failed', { error: (e as Error).message });
    }
  }
  return loadKeys(userId).filter((k) => !k.revokedAt);
}

export async function createDevKey(
  userId: string,
  name: string,
  scopes: DevKeyScope[],
): Promise<CreateKeyResult> {
  // Validate name
  if (!name || name.length > 80) throw new Error('name must be 1-80 characters');

  // Validate scopes
  const validScopes = scopes.filter((s) => VALID_SCOPES.has(s));
  if (validScopes.length === 0) throw new Error(`At least one valid scope required: ${[...VALID_SCOPES].join(', ')}`);

  // Enforce per-user limit
  const existing = await listDevKeys(userId);
  if (existing.length >= MAX_KEYS_PER_USER) {
    throw new Error(`Maximum ${MAX_KEYS_PER_USER} developer keys per user`);
  }

  // Generate a cryptographically strong key
  const rawKey = KEY_PREFIX + randomBytes(32).toString('base64url');
  const keyHash = hashKey(rawKey);
  const prefix  = rawKey.slice(0, 16);  // cgntx_sk_XXXXXX

  const key: DeveloperKey = {
    id:        randomUUID(),
    userId,
    name:      name.trim(),
    scopes:    validScopes,
    keyHash,
    prefix,
    createdAt: new Date().toISOString(),
    lastUsed:  null,
    revokedAt: null,
  };

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const resp = await sbFetch('/rest/v1/developer_keys', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          id:         key.id,
          user_id:    userId,
          name:       key.name,
          scopes:     key.scopes,
          key_hash:   key.keyHash,
          prefix:     key.prefix,
          created_at: key.createdAt,
        }),
      });
      if (!resp.ok) throw new Error(`Supabase insert failed: ${resp.status}`);
    } catch (e) {
      logger.warn('devkeys_supabase_create_failed', { error: (e as Error).message });
      // Fall back to file
      const keys = loadKeys(userId);
      keys.push(key);
      saveKeys(userId, keys);
    }
  } else {
    const keys = loadKeys(userId);
    keys.push(key);
    saveKeys(userId, keys);
  }

  logger.info('devkey_created', { userId, keyId: key.id, name: key.name, scopes: key.scopes });
  return { key, rawKey };
}

export async function revokeDevKey(userId: string, keyId: string): Promise<void> {
  const revokedAt = new Date().toISOString();

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const resp = await sbFetch(
        `/rest/v1/developer_keys?id=eq.${encodeURIComponent(keyId)}&user_id=eq.${encodeURIComponent(userId)}`,
        { method: 'PATCH', body: JSON.stringify({ revoked_at: revokedAt }) },
      );
      if (resp.ok) {
        logger.info('devkey_revoked', { userId, keyId });
        return;
      }
    } catch (e) {
      logger.warn('devkeys_supabase_revoke_failed', { error: (e as Error).message });
    }
  }

  const keys = loadKeys(userId);
  const idx  = keys.findIndex((k) => k.id === keyId);
  if (idx === -1) throw new Error('Developer key not found');
  keys[idx].revokedAt = revokedAt;
  saveKeys(userId, keys);
  logger.info('devkey_revoked', { userId, keyId });
}

/** Authenticate a raw developer key; returns the key record or null. */
export async function authenticateDevKey(rawKey: string): Promise<DeveloperKey | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = hashKey(rawKey);

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      // Fetch by prefix (cheap index lookup) then verify with timing-safe compare
      const prefix = rawKey.slice(0, 16);
      const resp = await sbFetch(
        `/rest/v1/developer_keys?prefix=eq.${encodeURIComponent(prefix)}&revoked_at=is.null&select=*`,
        {},
      );
      if (resp.ok) {
        const rows = await resp.json() as Record<string, unknown>[];
        for (const row of rows) {
          const stored = String(row['key_hash'] ?? '');
          // Timing-safe comparison to prevent hash oracle attacks
          if (stored.length === hash.length && timingSafeHexEqual(stored, hash)) {
            sbFetch(
              `/rest/v1/developer_keys?id=eq.${row['id']}`,
              { method: 'PATCH', body: JSON.stringify({ last_used: new Date().toISOString() }) },
            ).catch(() => {});
            return rowToKey(row);
          }
        }
      }
    } catch { /* fall through to file */ }
  }

  // File fallback — scan all user key files
  try {
    const { readdirSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    if (existsSync(KEYS_DIR)) {
      for (const fname of readdirSync(KEYS_DIR)) {
        if (!fname.endsWith('.json')) continue;
        const filePath = pathJoin(KEYS_DIR, fname);
        try {
          const keys = JSON.parse(readFileSync(filePath, 'utf8')) as DeveloperKey[];
          for (const k of keys) {
            if (!k.revokedAt && k.keyHash.length === hash.length && timingSafeHexEqual(k.keyHash, hash)) {
              return k;
            }
          }
        } catch { /* skip malformed file */ }
      }
    }
  } catch { /* ignore */ }

  return null;
}

export function hasScope(key: DeveloperKey, required: DevKeyScope): boolean {
  return key.scopes.includes('*') || key.scopes.includes(required);
}

// ── Row mapping ───────────────────────────────────────────────────────────────

function rowToKey(row: Record<string, unknown>): DeveloperKey {
  return {
    id:        String(row['id'] ?? row['id']),
    userId:    String(row['user_id'] ?? row['userId']),
    name:      String(row['name']),
    scopes:    (row['scopes'] as DevKeyScope[]) ?? [],
    keyHash:   String(row['key_hash'] ?? row['keyHash']),
    prefix:    String(row['prefix']),
    createdAt: String(row['created_at'] ?? row['createdAt']),
    lastUsed:  row['last_used'] ? String(row['last_used']) : null,
    revokedAt: row['revoked_at'] ? String(row['revoked_at']) : null,
  };
}
