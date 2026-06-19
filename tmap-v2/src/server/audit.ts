// Audit logging for tmap-v2 — calls log_audit_event RPC via Supabase REST.
// Uses the same fetch-based approach as db.ts (no Supabase JS client dependency).
// Never throws: audit failures must not break the calling request.

import { getCorrelationId, getRequestId } from './correlation.js';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface AuditParams {
  actorId?:      string | null;
  actorIp?:      string | null;
  action:        string;
  resourceType?: string;
  resourceId?:   string;
  outcome?:      'success' | 'failure' | 'blocked';
  severity?:     'debug' | 'info' | 'warn' | 'critical';
  metadata?:     Record<string, unknown>;
  userAgent?:    string;
}

export const AuditAction = {
  AUTH_LOGIN:       'auth.login',
  AUTH_FAILED:      'auth.login_failed',
  AUTH_LOGOUT:      'auth.logout',
  KEY_ACCESSED:     'key.accessed',
  KEY_CREATED:      'key.created',
  KEY_DELETED:      'key.deleted',
  RATE_LIMIT_HIT:   'security.rate_limit_hit',
  BOT_BLOCKED:      'security.bot_blocked',
  TMAP_RUN:         'tmap.run',
  SESSION_CREATED:  'session.created',
} as const;

export async function logAuditEvent(params: AuditParams): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  try {
    const body = {
      p_actor_id:      params.actorId ?? null,
      p_actor_ip:      params.actorIp ?? null,
      p_action:        params.action,
      p_resource_type: params.resourceType ?? null,
      p_resource_id:   params.resourceId ?? null,
      p_outcome:       params.outcome ?? 'success',
      p_severity:      params.severity ?? 'info',
      p_metadata:      params.metadata ?? {},
      p_corr_id:       getCorrelationId() ?? null,
      p_user_agent:    params.userAgent ?? null,
    };

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_audit_event`, {
      method: 'POST',
      headers: {
        apikey:          SUPABASE_KEY,
        Authorization:   `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[CGNTX][Audit] logAuditEvent failed:', (err as Error).message);
  }
}

export function getClientIp(req: import('express').Request): string {
  return (
    (req.headers['cf-connecting-ip'] as string) ??
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    (req.headers['x-real-ip'] as string) ??
    req.ip ??
    'unknown'
  );
}
