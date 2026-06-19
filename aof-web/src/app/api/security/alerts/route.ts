// GET   /api/security/alerts — list security alerts (alerts:read)
// PATCH /api/security/alerts — resolve an alert (alerts:resolve) { alertId }

import { NextResponse } from 'next/server';
import { getUserFromRequest, getAdminSupabase } from '@/lib/server/supabase-admin';
import { hasPermission } from '@/lib/server/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(await hasPermission(user.id, 'alerts:read'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const unresolved = params.get('unresolved') !== 'false';
  const severity   = params.get('severity');
  const limit      = Math.min(parseInt(params.get('limit') ?? '50', 10), 200);

  let q = getAdminSupabase()
    .from('security_alerts')
    .select('id, ts, alert_type, actor_ip, actor_id, severity, resolved_at, resolved_by, metadata')
    .order('ts', { ascending: false })
    .limit(limit);

  if (unresolved) q = q.is('resolved_at', null);
  if (severity)   q = q.eq('severity', severity);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 });

  return NextResponse.json({ alerts: data ?? [] });
}

export async function PATCH(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!(await hasPermission(user.id, 'alerts:resolve'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { alertId?: string } = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.alertId) return NextResponse.json({ error: 'alertId_required' }, { status: 400 });

  const { error } = await getAdminSupabase()
    .from('security_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq('id', body.alertId)
    .is('resolved_at', null);

  if (error) return NextResponse.json({ error: 'resolve_failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
