import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { findUserById, type UserRecord } from './db.js';

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

  let payload: { sub: string };
  try {
    payload = jwt.verify(token, jwtSecret()) as { sub: string };
  } catch {
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  try {
    const user = await findUserById(payload.sub);
    if (!user) { res.status(401).json({ error: 'user not found' }); return; }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'auth error' });
  }
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
