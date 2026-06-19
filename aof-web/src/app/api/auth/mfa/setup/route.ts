// POST /api/auth/mfa/setup — enroll TOTP (generates secret + backup codes)
// GET  /api/auth/mfa/setup — return current MFA status for the caller

import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import { setupMfa, isMfaEnabled, verifyAndEnableMfa } from '@/lib/server/mfa';
import { logAuditEvent, AuditAction, getClientIp } from '@/lib/server/audit';
import { checkPreset } from '@/lib/server/rate-limit-redis';
import { getCorrelationId } from '@/lib/server/correlation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const enabled = await isMfaEnabled(user.id);
  return NextResponse.json({ mfaEnabled: enabled });
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ip = getClientIp(req);
  const rl = await checkPreset(`${user.id}:${ip}`, 'mfaSetup');
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { action?: string; token?: string } = {};
  try { body = await req.json(); } catch { /* empty body = initiate setup */ }

  const correlationId = getCorrelationId(req);

  // action=confirm: verify TOTP token to enable MFA
  if (body.action === 'confirm') {
    if (!body.token || typeof body.token !== 'string') {
      return NextResponse.json({ error: 'token_required' }, { status: 400 });
    }
    try {
      await verifyAndEnableMfa(user.id, body.token);
      await logAuditEvent({
        actorId: user.id, actorIp: ip,
        action: AuditAction.MFA_ENABLED, outcome: 'success', severity: 'info', correlationId,
      });
      return NextResponse.json({ ok: true, mfaEnabled: true });
    } catch {
      await logAuditEvent({
        actorId: user.id, actorIp: ip,
        action: AuditAction.MFA_FAILED, outcome: 'failure', severity: 'warn', correlationId,
      });
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    }
  }

  // Default: initiate setup
  const email = user.email ?? user.id;
  try {
    const result = await setupMfa(user.id, email);
    // backupCodes are shown ONCE — never stored plaintext
    return NextResponse.json({
      secret:      result.secret,
      otpAuthUri:  result.otpAuthUri,
      backupCodes: result.backupCodes,
    });
  } catch (err) {
    return NextResponse.json({ error: 'setup_failed', detail: (err as Error).message }, { status: 500 });
  }
}
