import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getAdminSupabase } from '@/lib/server/supabase-admin';
import { getAllQueueStats, getDLQ, type QueueStats } from '@/lib/server/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/queue — returns stats for all queues (admin-only)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Restrict to admin roles
  const sb = getAdminSupabase();
  const { data: roleRow } = await sb
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['OWNER', 'ADMIN'])
    .maybeSingle();

  if (!roleRow) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const stats: QueueStats[] = await getAllQueueStats();
    return NextResponse.json({ queues: stats, ts: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/queue?queue=dlq&action=drain — admin queue management
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getAdminSupabase();
  const { data: roleRow } = await sb
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['OWNER', 'ADMIN'])
    .maybeSingle();

  if (!roleRow) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const queue  = searchParams.get('queue');
  const action = searchParams.get('action') ?? 'drain';

  if (queue === 'dlq' && action === 'drain') {
    try {
      const dlq = getDLQ();
      await dlq.drain();
      return NextResponse.json({ drained: 'dlq' });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown queue or action' }, { status: 400 });
}
