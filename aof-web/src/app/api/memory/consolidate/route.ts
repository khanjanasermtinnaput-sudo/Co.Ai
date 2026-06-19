import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import { enqueueConsolidation } from '@/lib/server/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/memory/consolidate
// Enqueues a background job to consolidate a session's conversation turns into long-term memories.
// Body: { sessionId, maxMemories?, delayMs? }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { sessionId: string; maxMemories?: number; delayMs?: number };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return NextResponse.json({ error: '`sessionId` is required' }, { status: 400 });
  }

  const maxMemories = Math.min(body.maxMemories ?? 10, 50);
  const delayMs     = Math.max(0, Math.min(body.delayMs ?? 5000, 60_000));

  try {
    const jobId = await enqueueConsolidation(
      { userId: user.id, sessionId: body.sessionId, maxMemories },
      delayMs
    );
    return NextResponse.json({ jobId, queued: true, delayMs }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
