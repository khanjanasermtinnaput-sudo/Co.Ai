// Audit event log — persists security-relevant events (auth, key ops, sandbox
// executions) to Supabase when available, with a local JSON-lines file fallback.
//
// Each event is also emitted as a structured log line at WARN or INFO level so
// log aggregators (Datadog, Loki, Cloud Logging) pick it up automatically.

import { appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { logger } from './logger.js';

// ── Event schema ──────────────────────────────────────────────────────────────

export const AuditAction = {
  AUTH_LOGIN:        'auth.login',
  AUTH_FAILED:       'auth.failed',
  AUTH_REGISTER:     'auth.register',
  AUTH_LOGOUT:       'auth.logout',
  KEY_CREATED:       'key.created',
  KEY_ROTATED:       'key.rotated',
  KEY_REVOKED:       'key.revoked',
  KEY_VALIDATED:     'key.validated',
  SANDBOX_RUN:       'sandbox.run',
  SANDBOX_BLOCKED:   'sandbox.blocked',
  QUOTA_EXCEEDED:    'quota.exceeded',
  WEBHOOK_DELIVERED: 'webhook.delivered',
  WEBHOOK_FAILED:    'webhook.failed',
  DEV_KEY_CREATED:   'devkey.created',
  DEV_KEY_REVOKED:   'devkey.revoked',
  ADMIN_ACTION:      'admin.action',
} as const;

export type AuditAction = typeof AuditAction[keyof typeof AuditAction];

export interface AuditEventPayload {
  actorId:    string | null;
  actorIp:    string;
  action:     AuditAction;
  outcome:    'success' | 'failure';
  severity?:  'info' | 'warn' | 'error';
  metadata?:  Record<string, unknown>;
  userAgent?: string;
}

export interface AuditEvent extends AuditEventPayload {
  id:  string;
  ts:  string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const AUDIT_DIR = process.env.AUDIT_LOG_DIR
  ?? (process.env.VERCEL ? '/tmp/coagentix-audit' : join(process.cwd(), '.aof-server', 'audit'));

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function auditLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(AUDIT_DIR, `audit-${date}.jsonl`);
}

function writeLocalFallback(event: AuditEvent): void {
  try {
    const path = auditLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
  } catch (e) {
    logger.warn('audit_write_failed', { error: (e as Error).message });
  }
}

async function writeToSupabase(event: AuditEvent): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const row = {
    id:         event.id,
    actor_id:   event.actorId,
    actor_ip:   event.actorIp,
    action:     event.action,
    outcome:    event.outcome,
    severity:   event.severity ?? 'info',
    metadata:   event.metadata ?? {},
    user_agent: event.userAgent ?? '',
    ts:         event.ts,
  };
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/audit_events`, {
    method:  'POST',
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(3_000),
  });
  if (!resp.ok) throw new Error(`Supabase audit insert failed: ${resp.status}`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  return String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();
}

export async function logAuditEvent(payload: AuditEventPayload): Promise<void> {
  const event: AuditEvent = {
    ...payload,
    id: randomUUID(),
    ts: new Date().toISOString(),
  };

  const level = payload.severity === 'error' ? 'error'
    : payload.severity === 'warn'  ? 'warn'
    : 'info';

  logger[level]('audit', {
    action:  event.action,
    outcome: event.outcome,
    actor:   event.actorId ?? 'anonymous',
    ip:      event.actorIp,
    ...(event.metadata ?? {}),
  });

  // Write to Supabase (best-effort) and always fall back to local file
  try {
    await writeToSupabase(event);
  } catch {
    writeLocalFallback(event);
  }
}
