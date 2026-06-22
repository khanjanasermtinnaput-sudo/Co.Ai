import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { findUserById, loadProviderKeysFromSupabase, getUserRole, type UserRecord, type ProviderKeyName } from './db.js';
import { verifySupabaseToken } from './supabase-auth.js';
import { decryptSecret } from './crypto.js';
import { logAuditEvent, AuditAction, getClientIp } from './audit.js';

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
