// GET    /api/auth/devices — list registered devices
// PATCH  /api/auth/devices — trust a device  { deviceId, action: 'trust' }
// DELETE /api/auth/devices — revoke a device { deviceId }

import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import { listDevices, trustDevice, revokeDevice } from '@/lib/server/device';
import { logAuditEvent, AuditAction, getClientIp } from '@/lib/server/audit';
import { getCorrelationId } from '@/lib/server/correlation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const devices = await listDevices(user.id);
    return NextResponse.json({ devices });
  } catch (err) {
    return NextResponse.json({ error: 'load_failed', detail: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { deviceId?: string } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.deviceId) return NextResponse.json({ error: 'deviceId_required' }, { status: 400 });

  const ip = getClientIp(req);
  const correlationId = getCorrelationId(req);

  try {
    await trustDevice(body.deviceId, user.id);
    await logAuditEvent({
      actorId: user.id, actorIp: ip, action: AuditAction.DEVICE_TRUSTED,
      resourceType: 'device', resourceId: body.deviceId, correlationId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'trust_failed', detail: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { deviceId?: string } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.deviceId) return NextResponse.json({ error: 'deviceId_required' }, { status: 400 });

  const ip = getClientIp(req);
  const correlationId = getCorrelationId(req);

  try {
    await revokeDevice(body.deviceId, user.id);
    await logAuditEvent({
      actorId: user.id, actorIp: ip, action: AuditAction.DEVICE_REVOKED,
      resourceType: 'device', resourceId: body.deviceId, correlationId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'revoke_failed', detail: (err as Error).message }, { status: 500 });
  }
}
