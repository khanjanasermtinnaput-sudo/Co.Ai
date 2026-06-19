// Session store — tracks Supabase sessions in user_sessions table.
// session_token_hash = HMAC-SHA256(token, SESSION_HMAC_SECRET || JWT_SECRET).
// Never stores the plaintext token.

import { createHmac } from 'node:crypto';
import { getAdminSupabase } from './supabase-admin';

const SESSION_TTL_DAYS = 7;

function hmacSecret(): string {
  const s = process.env.SESSION_HMAC_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (!s) throw new Error('SESSION_HMAC_SECRET or SUPABASE_JWT_SECRET required for session tracking');
  return s;
}

export function hashToken(token: string): string {
  return createHmac('sha256', hmacSecret()).update(token).digest('hex');
}

export interface TrackedSession {
  id:            string;
  userId:        string;
  deviceId:      string | null;
  ipAddress:     string | null;
  userAgent:     string | null;
  lastActiveAt:  string;
  expiresAt:     string;
  revokedAt:     string | null;
  revokeReason:  string | null;
  createdAt:     string;
}

export async function trackSession(params: {
  userId:    string;
  token:     string;
  deviceId?: string | null;
  ip?:       string;
  userAgent?: string;
}): Promise<string> {
  const tokenHash = hashToken(params.token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();

  const db = getAdminSupabase();
  const { data, error } = await db.rpc('upsert_session', {
    p_user_id:    params.userId,
    p_token_hash: tokenHash,
    p_device_id:  params.deviceId ?? null,
    p_ip:         params.ip ?? null,
    p_user_agent: params.userAgent ?? null,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(`trackSession failed: ${error.message}`);
  return data as string;
}

export async function revokeSession(sessionId: string, userId: string, reason?: string): Promise<void> {
  const { error } = await getAdminSupabase()
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason ?? 'user_revoked' })
    .eq('id', sessionId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function revokeAllSessions(userId: string, exceptHash?: string): Promise<number> {
  const db = getAdminSupabase();
  const patch = { revoked_at: new Date().toISOString(), revoke_reason: 'all_revoked' };

  const { error, count } = exceptHash
    ? await db.from('user_sessions')
        .update(patch)
        .eq('user_id', userId)
        .is('revoked_at', null)
        .neq('session_token_hash', exceptHash)
    : await db.from('user_sessions')
        .update(patch)
        .eq('user_id', userId)
        .is('revoked_at', null);

  if (error) throw error;
  return count ?? 0;
}

export async function listSessions(userId: string): Promise<TrackedSession[]> {
  const { data, error } = await getAdminSupabase()
    .from('user_sessions')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('last_active_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id:           r.id as string,
    userId:       r.user_id as string,
    deviceId:     r.device_id as string | null,
    ipAddress:    r.ip_address as string | null,
    userAgent:    r.user_agent as string | null,
    lastActiveAt: r.last_active_at as string,
    expiresAt:    r.expires_at as string,
    revokedAt:    r.revoked_at as string | null,
    revokeReason: r.revoke_reason as string | null,
    createdAt:    r.created_at as string,
  }));
}

export async function isSessionRevoked(tokenHash: string): Promise<boolean> {
  const { data } = await getAdminSupabase()
    .from('user_sessions')
    .select('revoked_at, expires_at')
    .eq('session_token_hash', tokenHash)
    .single();

  if (!data) return false; // Not tracked = not explicitly revoked
  const row = data as { revoked_at: string | null; expires_at: string };
  if (row.revoked_at) return true;
  if (new Date(row.expires_at) < new Date()) return true;
  return false;
}
