// Audit logging — writes to audit_log via log_audit_event RPC (service_role).
// Never throws: audit failures must not break the calling request.

import { getAdminSupabase } from './supabase-admin';

export interface AuditParams {
  actorId:       string | null;
  actorIp?:      string | null;
  action:        string;
  resourceType?: string;
  resourceId?:   string;
  outcome?:      'success' | 'failure' | 'blocked';
  severity?:     'debug' | 'info' | 'warn' | 'critical';
  metadata?:     Record<string, unknown>;
  correlationId?: string;
  userAgent?:    string;
}

// Well-known action strings (<category>.<verb>)
export const AuditAction = {
  AUTH_LOGIN:           'auth.login',
  AUTH_LOGOUT:          'auth.logout',
  AUTH_FAILED:          'auth.login_failed',
  MFA_ENABLED:          'mfa.enabled',
  MFA_DISABLED:         'mfa.disabled',
  MFA_VERIFIED:         'mfa.verified',
  MFA_FAILED:           'mfa.failed',
  MFA_BACKUP_USED:      'mfa.backup_code_used',
  SESSION_REVOKED:      'session.revoked',
  SESSION_ALL_REVOKED:  'session.all_revoked',
  DEVICE_TRUSTED:       'device.trusted',
  DEVICE_REVOKED:       'device.revoked',
  KEY_CREATED:          'key.created',
  KEY_ROTATED:          'key.rotated',
  KEY_DELETED:          'key.deleted',
  KEY_ACCESSED:         'key.accessed',
  ROLE_GRANTED:         'role.granted',
  ROLE_REVOKED:         'role.revoked',
  SECURITY_ALERT:       'security.alert_created',
  RATE_LIMIT_HIT:       'security.rate_limit_hit',
  BOT_BLOCKED:          'security.bot_blocked',
} as const;

export type AuditActionValue = typeof AuditAction[keyof typeof AuditAction];

export async function logAuditEvent(params: AuditParams): Promise<void> {
  try {
    const db = getAdminSupabase();
    await db.rpc('log_audit_event', {
      p_actor_id:      params.actorId,
      p_actor_ip:      params.actorIp ?? null,
      p_action:        params.action,
      p_resource_type: params.resourceType ?? null,
      p_resource_id:   params.resourceId ?? null,
      p_outcome:       params.outcome ?? 'success',
      p_severity:      params.severity ?? 'info',
      p_metadata:      params.metadata ?? {},
      p_corr_id:       params.correlationId ?? null,
      p_user_agent:    params.userAgent ?? null,
    });
  } catch (err) {
    console.error('[CGNTX][Audit] logAuditEvent failed:', (err as Error).message);
  }
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}
