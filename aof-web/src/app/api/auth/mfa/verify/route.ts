// POST /api/auth/mfa/verify — verify a TOTP code or backup code at login time.
// Returns { ok: true } on success; 401 on failure.

import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import { verifyTotp, verifyBackupCode } from '@/lib/server/mfa';
import { logAuditEvent, AuditAction, getClientIp } from '@/lib/server/audit';
import { checkPreset } from '@/lib/server/rate-limit-redis';
import { getCorrelationId } from '@/lib/server/correlation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ip = getClientIp(req);
  const rl = await checkPreset(`${user.id}:${ip}`, 'auth');
  if (!rl.allowed) {
    await logAuditEvent({
      actorId: user.id, actorIp: ip, action: AuditAction.RATE_LIMIT_HIT,
      outcome: 'blocked', severity: 'warn',
    });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { token?: string; type?: 'totp' | 'backup' } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const correlationId = getCorrelationId(req);
  const type = body.type ?? 'totp';
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 400 });

  const valid = type === 'backup'
    ? await verifyBackupCode(user.id, token)
    : await verifyTotp(user.id, token);

  if (!valid) {
    await logAuditEvent({
      actorId: user.id, actorIp: ip, action: AuditAction.MFA_FAILED,
      outcome: 'failure', severity: 'warn', correlationId,
      metadata: { type },
    });
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  const action = type === 'backup' ? AuditAction.MFA_BACKUP_USED : AuditAction.MFA_VERIFIED;
  await logAuditEvent({ actorId: user.id, actorIp: ip, action, outcome: 'success', correlationId });
  return NextResponse.json({ ok: true });
}
