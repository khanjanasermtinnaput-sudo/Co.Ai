// GET  /api/auth/sessions — list active sessions for the signed-in user
// DELETE /api/auth/sessions — revoke a session or all sessions
//   body: { sessionId?: string } — omit to revoke all

import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import { listSessions, revokeSession, revokeAllSessions } from '@/lib/server/session-store';
import { logAuditEvent, AuditAction, getClientIp } from '@/lib/server/audit';
import { getCorrelationId } from '@/lib/server/correlation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const sessions = await listSessions(user.id);
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json({ error: 'load_failed', detail: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { sessionId?: string } = {};
  try { body = await req.json(); } catch { /* revoke all */ }

  const ip = getClientIp(req);
  const correlationId = getCorrelationId(req);

  try {
    if (body.sessionId) {
      await revokeSession(body.sessionId, user.id);
      await logAuditEvent({
        actorId: user.id, actorIp: ip, action: AuditAction.SESSION_REVOKED,
        resourceType: 'session', resourceId: body.sessionId, correlationId,
      });
      return NextResponse.json({ ok: true, revoked: 1 });
    } else {
      const count = await revokeAllSessions(user.id);
      await logAuditEvent({
        actorId: user.id, actorIp: ip, action: AuditAction.SESSION_ALL_REVOKED,
        outcome: 'success', severity: 'warn', correlationId,
        metadata: { count },
      });
      return NextResponse.json({ ok: true, revoked: count });
    }
  } catch (err) {
    return NextResponse.json({ error: 'revoke_failed', detail: (err as Error).message }, { status: 500 });
  }
}
