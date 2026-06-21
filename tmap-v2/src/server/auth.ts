import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { findUserById, loadProviderKeysFromSupabase, type UserRecord, type ProviderKeyName } from './db.js';
import { verifySupabaseToken } from './supabase-auth.js';
import { decryptSecret } from './crypto.js';

/**
 * Keep only ciphertexts that actually decrypt with THIS server's master key. If
 * the backend's COAGENTIX_MASTER_KEY differs from the one aof-web used to encrypt
 * the key, decryption would otherwise throw deep inside an endpoint and surface as
 * a 500. Dropping the bad entry degrades cleanly to "no key configured" instead.
 */
function keepDecryptableKeys(
  keys: Partial<Record<ProviderKeyName, string>>,
): Partial<Record<ProviderKeyName, string>> {
  const out: Partial<Record<ProviderKeyName, string>> = {};
  const dropped: string[] = [];
  for (const [provider, blob] of Object.entries(keys)) {
    if (!blob) continue;
    try {
      decryptSecret(blob);
      out[provider as ProviderKeyName] = blob;
    } catch {
      // master-key mismatch / corrupt ciphertext — skip this key.
      dropped.push(provider);
    }
  }
  // Surface the silent-degrade case: if a user HAS stored keys but none decrypt,
  // it almost always means COAGENTIX_MASTER_KEY differs from the one aof-web used
  // to encrypt them. Without this log the only symptom is a confusing "no key"
  // error, so make the real cause visible to the operator in the server logs.
  if (dropped.length) {
    const total = Object.values(keys).filter(Boolean).length;
    console.warn(
      `[auth] dropped ${dropped.length}/${total} provider key(s) that failed to decrypt ` +
      `(${dropped.join(', ')}). Likely COAGENTIX_MASTER_KEY mismatch between this backend ` +
      `and the frontend that stored the keys — they MUST be identical.`,
    );
  }
  return out;
}

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET missing or too short');
  return s;
}

// Session tokens are short-lived; clients refresh via POST /v1/auth/refresh (a
// valid, non-expired token is exchanged for a fresh one — sliding session). This
// limits the blast radius of a leaked token to ~7 days instead of a month.
const TOKEN_TTL = '7d';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret(), { expiresIn: TOKEN_TTL });
}

export interface AuthedRequest extends Request {
  user?: UserRecord;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'missing token' }); return; }

  // 1) Native tmap-v2 JWT (username/PIN web accounts + CLI).
  let payload: { sub: string } | null = null;
  try {
    payload = jwt.verify(token, jwtSecret()) as { sub: string };
  } catch {
    payload = null;
  }

  if (payload) {
    try {
      const user = await findUserById(payload.sub);
      if (!user) { res.status(401).json({ error: 'user not found' }); return; }
      req.user = user;
      next();
      return;
    } catch {
      res.status(401).json({ error: 'auth error' });
      return;
    }
  }

  // 2) Bridge: Supabase (Google) access token from the aof-web frontend. Verify it
  // against the Supabase Auth API and synthesize a user whose keys come from the
  // shared provider_keys table — so Google-signed-in users can reach /v1/* with the
  // keys they saved in Settings, without a separate username/PIN account.
  const ident = await verifySupabaseToken(token);
  if (ident) {
    try {
      const encryptedKeys = keepDecryptableKeys(await loadProviderKeysFromSupabase(ident.id));
      req.user = {
        id: ident.id,
        username: ident.email || ident.id,
        pinHash: '',
        encryptedKeys,
        createdAt: new Date().toISOString(),
      };
      next();
      return;
    } catch {
      res.status(401).json({ error: 'auth error' });
      return;
    }
  }

  res.status(401).json({ error: 'invalid token' });
}

// Admin allowlist — comma-separated usernames in COAGENTIX_ADMIN_USERNAMES.
// User accounts have no role column, so privileged system/infra operations
// (backup, restore, disaster-recovery, failover, infra & platform analytics)
// are gated by this explicit allowlist instead. Secure by default: when the
// env var is unset, NO user is treated as admin and these endpoints reject all
// callers — the correct posture for destructive / cross-tenant operations.
function adminUsernames(): Set<string> {
  return new Set(
    (process.env.COAGENTIX_ADMIN_USERNAMES ?? process.env.AOF_ADMIN_USERNAMES ?? '')
      .split(',')
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminUser(user: UserRecord | undefined): boolean {
  if (!user) return false;
  return adminUsernames().has(user.username.toLowerCase());
}

// Must run AFTER requireAuth (relies on req.user being populated).
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isAdminUser(req.user)) {
    res.status(403).json({ error: 'admin privileges required' });
    return;
  }
  next();
}
