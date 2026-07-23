// ── CLI authentication ────────────────────────────────────────────────────────
// Validates raw CLI tokens (issued via the web Settings page) against Supabase,
// then returns a standard tmap-v2 JWT so all existing routes work unchanged.
//
// Flow:  coai login → POST /v1/cli/auth → validate cli_tokens row →
//        upsert tmap-v2 user → sign JWT → CLI stores JWT locally

import { createHash, randomBytes } from 'node:crypto';
import { signToken } from './auth.js';
import { findUserById, createUser } from './db.js';
import type { Request, Response } from 'express';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbReady(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

interface CliTokenRow {
  id: string;
  user_id: string;
  revoked_at: string | null;
  expires_at: string | null;
}

interface SupabaseAuthUser {
  id: string;
  email: string;
  app_metadata: { tier?: string };
}

async function lookupCliToken(raw: string): Promise<CliTokenRow | null> {
  const hash = createHash('sha256').update(raw).digest('hex');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cli_tokens?token_hash=eq.${encodeURIComponent(hash)}&select=id,user_id,revoked_at,expires_at&limit=1`,
    {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as CliTokenRow[];
  return rows[0] ?? null;
}

async function getSupabaseUser(userId: string): Promise<SupabaseAuthUser | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) return null;
  return res.json() as Promise<SupabaseAuthUser>;
}

async function updateTokenLastUsed(tokenId: string): Promise<void> {
  await fetch(
    `${SUPABASE_URL}/rest/v1/cli_tokens?id=eq.${encodeURIComponent(tokenId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    },
  );
}

async function upsertCliSession(
  tokenId: string,
  userId: string,
  deviceName: string,
  ip: string,
  ua: string,
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/cli_sessions`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      token_id: tokenId,
      user_id: userId,
      device_name: deviceName,
      ip_address: ip,
      user_agent: ua,
    }),
  });
}

/**
 * POST /v1/cli/auth
 * Body: { token: "coai_...", device?: "my-machine" }
 * Returns: { jwt, userId, email, tier }
 */
export async function handleCliAuth(req: Request, res: Response): Promise<void> {
  if (!sbReady()) {
    res.status(503).json({ error: 'Supabase not configured on this server' });
    return;
  }

  const { token: rawToken, device } = (req.body ?? {}) as { token?: string; device?: string };

  if (!rawToken || !rawToken.startsWith('coai_') || rawToken.length < 40) {
    res.status(400).json({ error: 'invalid-token-format' });
    return;
  }

  const row = await lookupCliToken(rawToken);
  if (!row) {
    res.status(401).json({ error: 'token-not-found' });
    return;
  }
  if (row.revoked_at) {
    res.status(401).json({ error: 'token-revoked' });
    return;
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    res.status(401).json({ error: 'token-expired' });
    return;
  }

  const sbUser = await getSupabaseUser(row.user_id);
  if (!sbUser) {
    res.status(401).json({ error: 'user-not-found' });
    return;
  }

  const tier = sbUser.app_metadata?.tier ?? 'FREE';
  if (tier !== 'ADVANCED') {
    res.status(403).json({ error: 'advanced-subscription-required' });
    return;
  }

  // Ensure a mirrored tmap-v2 user exists for this Supabase user so the
  // standard requireAuth + findUserById path works for all downstream routes.
  let tmapUser = await findUserById(row.user_id);
  if (!tmapUser) {
    const username = `cli_${sbUser.email.replace(/[^a-z0-9]/gi, '_').slice(0, 24)}`;
    const fallbackPin = randomBytes(8).toString('hex'); // not used for CLI logins
    tmapUser = await createUser(username, fallbackPin).catch(async () => {
      // username conflict (e.g. duplicate) — find by id again
      return (await findUserById(row.user_id))!;
    });
  }

  // Track last-used and device session.
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const ua = req.headers['user-agent'] ?? 'coai-cli';
  const deviceName = (typeof device === 'string' ? device : ua).slice(0, 100);

  await Promise.all([
    updateTokenLastUsed(row.id),
    upsertCliSession(row.id, row.user_id, deviceName, ip, ua),
  ]);

  const jwt = signToken(tmapUser.id);
  res.json({ jwt, userId: tmapUser.id, email: sbUser.email, tier });
}

/**
 * GET /v1/cli/status
 * Used by `coai status` — quick auth check, returns account info.
 */
export async function handleCliStatus(req: Request, res: Response): Promise<void> {
  // This route is protected by the standard requireAuth middleware upstream.
  const authedReq = req as Request & { user?: import('./db.js').UserRecord };
  if (!authedReq.user) {
    res.status(401).json({ error: 'not-authenticated' });
    return;
  }
  res.json({
    ok: true,
    userId: authedReq.user.id,
    username: authedReq.user.username,
    providers: Object.keys(authedReq.user.encryptedKeys ?? {}),
  });
}
