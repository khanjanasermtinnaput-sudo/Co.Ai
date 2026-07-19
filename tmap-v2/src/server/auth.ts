import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { findUserById, loadProviderKeysFromSupabase, getUserRole, type UserRecord, type ProviderKeyName } from './db.js';
import { verifySupabaseToken } from './supabase-auth.js';
import { decryptSecret } from './crypto.js';
import { logAuditEvent, AuditAction, getClientIp } from './audit.js';
import { getRedis } from './redis.js';

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
  if (!s || s.length < 32) throw new Error('JWT_SECRET missing or too short (minimum 32 characters required)');
  return s;
}

// Session tokens are short-lived; clients refresh via POST /v1/auth/refresh (a
// valid, non-expired token is exchanged for a fresh one — sliding session). This
// limits the blast radius of a leaked token to ~7 days instead of a month.
const TOKEN_TTL = '7d';
const TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

export function signToken(userId: string): string {
  // jti makes each token individually revocable (see revokeToken below).
  return jwt.sign({ sub: userId, jti: randomUUID() }, jwtSecret(), { expiresIn: TOKEN_TTL });
}

/** Throws when JWT_SECRET is missing/weak — same check signToken enforces.
 *  Call BEFORE creating state that a later signToken failure would strand
 *  (register once created the user first, then failed to sign, permanently
 *  burning the username on a misconfigured server). */
export function assertJwtSecret(): void {
  jwtSecret();
}

// ── Token revocation (denylist) ───────────────────────────────────────────────
// Leaked or logged-out tokens must die before their 7-day expiry. Two levels:
//   • per-token:  cgntx:jwt:deny:<jti> — set on logout / refresh rotation.
//   • per-user:   cgntx:jwt:denyuser:<sub> = epoch-ms — tokens ISSUED BEFORE
//     that moment are rejected (kills every outstanding session at once).
// Keys carry a TTL matching the token lifetime, so the denylist self-cleans.
// Backed by Redis when configured (cross-instance); the in-memory mock covers
// single-instance dev. Denylist read failures fail OPEN by design: revocation
// is a hardening layer on top of the 7-day expiry, and failing closed here
// would turn a Redis blip into a total login outage.

interface TokenPayload { sub: string; jti?: string; iat?: number; exp?: number }

const DENY_KEY     = (jti: string) => `cgntx:jwt:deny:${jti}`;
const DENYUSER_KEY = (sub: string) => `cgntx:jwt:denyuser:${sub}`;

/** Revoke a single (still-valid) token. Returns false when the token has no jti (pre-rollout). */
export async function revokeToken(token: string): Promise<boolean> {
  let payload: TokenPayload | null = null;
  try {
    payload = jwt.verify(token, jwtSecret()) as TokenPayload;
  } catch {
    return false; // invalid/expired — nothing to revoke
  }
  if (!payload.jti) return false;
  const ttl = payload.exp ? Math.max(1, payload.exp - Math.floor(Date.now() / 1000)) : TOKEN_TTL_SEC;
  try {
    await getRedis().setex(DENY_KEY(payload.jti), ttl, '1');
    return true;
  } catch {
    return false;
  }
}

/** Revoke EVERY token issued to a user before this moment. */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  try {
    await getRedis().setex(DENYUSER_KEY(userId), TOKEN_TTL_SEC, String(Date.now()));
  } catch { /* fail open — see note above */ }
}

async function isTokenRevoked(payload: TokenPayload): Promise<boolean> {
  try {
    const redis = getRedis();
    if (payload.jti && (await redis.get(DENY_KEY(payload.jti)))) return true;
    const deniedAt = await redis.get(DENYUSER_KEY(payload.sub));
    if (deniedAt && payload.iat && payload.iat * 1000 < Number(deniedAt)) return true;
  } catch { /* fail open — see note above */ }
  return false;
}

export interface AuthedRequest extends Request {
  user?: UserRecord;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'missing token' }); return; }

  // 1) Native tmap-v2 JWT (username/PIN web accounts + CLI).
  let payload: TokenPayload | null = null;
  try {
    payload = jwt.verify(token, jwtSecret()) as TokenPayload;
  } catch {
    payload = null;
  }

  if (payload) {
    if (await isTokenRevoked(payload)) {
      res.status(401).json({ error: 'token revoked' });
      return;
    }
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

// Admin authorization — DB-backed RBAC (Round 3 #1).
//
// Elevated roles live in the Supabase `user_roles` table (OWNER/ADMIN/STAFF),
// NOT in an environment variable keyed by username. This closes the previous
// privilege-escalation vector where a user could become admin simply by
// registering a username that matched COAGENTIX_ADMIN_USERNAMES.
//
// Fail-closed: if the role cannot be positively confirmed as elevated (no
// Supabase, lookup error, no row, expired role) access is denied.
//
// COAGENTIX_BREAKGLASS_ADMIN is an explicit, audited emergency override for when
// the role store is unreachable — it is never the normal path.
const ELEVATED_ROLES = new Set(['OWNER', 'ADMIN', 'STAFF']);

export function isElevatedRole(role: string | null | undefined): boolean {
  return !!role && ELEVATED_ROLES.has(role);
}

export interface AdminDecision { allow: boolean; via: 'role' | 'breakglass' | 'denied'; }

/** Pure admin-access decision (DB role first, then audited break-glass override). */
export function decideAdminAccess(
  role: string | null,
  username: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AdminDecision {
  if (isElevatedRole(role)) return { allow: true, via: 'role' };
  const breakglass = (env.COAGENTIX_BREAKGLASS_ADMIN ?? '')
    .split(',').map((u) => u.trim().toLowerCase()).filter(Boolean);
  if (username && breakglass.includes(username.toLowerCase())) return { allow: true, via: 'breakglass' };
  return { allow: false, via: 'denied' };
}

// Must run AFTER requireAuth (relies on req.user being populated). Async: looks
// up the caller's role in the database, then audits the access decision.
export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ error: 'authentication required' }); return; }

  let role: string | null = null;
  try { role = await getUserRole(user.id); } catch { role = null; }

  const decision = decideAdminAccess(role, user.username);
  const actorIp = getClientIp(req as never);

  if (!decision.allow) {
    try {
      await logAuditEvent({
        actorId: user.id, actorIp, action: AuditAction.ADMIN_ACTION, outcome: 'failure',
        severity: 'warn', metadata: { reason: 'admin access denied', path: (req as Request).path },
      });
    } catch { /* audit is best-effort */ }
    res.status(403).json({ error: 'admin privileges required' });
    return;
  }

  try {
    await logAuditEvent({
      actorId: user.id, actorIp, action: AuditAction.ADMIN_ACTION, outcome: 'success',
      severity: decision.via === 'breakglass' ? 'warn' : 'info',
      metadata: { via: decision.via, path: (req as Request).path, method: (req as Request).method },
    });
  } catch { /* audit is best-effort */ }
  next();
}
