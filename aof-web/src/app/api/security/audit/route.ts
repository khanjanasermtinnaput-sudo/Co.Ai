// GET /api/security/audit — paginated audit log (admin-only: audit:read permission)
// Query params: ?limit=50&before=<ISO>&actorId=<uuid>&action=<string>&severity=<string>

import { NextResponse } from 'next/server';
import { getUserFromRequest, getAdminSupabase } from '@/lib/server/supabase-admin';
import { hasPermission } from '@/lib/server/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const allowed = await hasPermission(user.id, 'audit:read');
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const limit    = Math.min(parseInt(params.get('limit') ?? `${DEFAULT_LIMIT}`, 10), MAX_LIMIT);
  const before   = params.get('before');
  const actorId  = params.get('actorId');
  const action   = params.get('action');
  const severity = params.get('severity');
  const outcome  = params.get('outcome');

  let q = getAdminSupabase()
    .from('audit_log')
    .select('id, ts, actor_id, actor_ip, action, resource_type, resource_id, outcome, severity, metadata, correlation_id')
    .order('ts', { ascending: false })
    .limit(limit);

  if (before) q = q.lt('ts', before);
  if (actorId) q = q.eq('actor_id', actorId);
  if (action)  q = q.eq('action', action);
  if (severity) q = q.eq('severity', severity);
  if (outcome)  q = q.eq('outcome', outcome);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 });

  const events = (data ?? []).map((r: Record<string, unknown>) => ({
    id:            r.id,
    ts:            r.ts,
    actorId:       r.actor_id,
    actorIp:       r.actor_ip,
    action:        r.action,
    resourceType:  r.resource_type,
    resourceId:    r.resource_id,
    outcome:       r.outcome,
    severity:      r.severity,
    metadata:      r.metadata,
    correlationId: r.correlation_id,
  }));

  return NextResponse.json({
    events,
    hasMore: events.length === limit,
    nextBefore: events.at(-1)?.ts ?? null,
  });
}
