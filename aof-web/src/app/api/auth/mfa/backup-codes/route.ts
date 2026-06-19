// POST /api/auth/mfa/backup-codes — regenerate backup codes.
// Requires a valid TOTP code to confirm. Returns 10 new codes (shown once).

import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import { verifyTotp, regenerateBackupCodes } from '@/lib/server/mfa';
import { logAuditEvent, AuditAction, getClientIp } from '@/lib/server/audit';
import { getCorrelationId } from '@/lib/server/correlation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { token?: string } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 400 });

  const ip = getClientIp(req);
  const correlationId = getCorrelationId(req);

  const valid = await verifyTotp(user.id, token);
  if (!valid) {
    await logAuditEvent({
      actorId: user.id, actorIp: ip, action: AuditAction.MFA_FAILED,
      outcome: 'failure', severity: 'warn', correlationId,
    });
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  try {
    const codes = await regenerateBackupCodes(user.id);
    await logAuditEvent({
      actorId: user.id, actorIp: ip, action: 'mfa.backup_codes_regenerated',
      outcome: 'success', severity: 'warn', correlationId,
    });
    return NextResponse.json({ backupCodes: codes });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
