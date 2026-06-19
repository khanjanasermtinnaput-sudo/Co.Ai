import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import { hybridSearch, semanticSearch, recallConversation, type MemoryType } from '@/lib/server/memory-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/memory/search
// Body: { query, type?, limit?, threshold?, mode?, sessionId? }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    query:      string;
    mode?:      'hybrid' | 'semantic' | 'recall';
    limit?:     number;
    threshold?: number;
    type?:      MemoryType;
    sessionId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.query || typeof body.query !== 'string') {
    return NextResponse.json({ error: '`query` is required' }, { status: 400 });
  }
  if (body.query.length > 4000) {
    return NextResponse.json({ error: '`query` exceeds 4 000 characters' }, { status: 400 });
  }

  const mode      = body.mode      ?? 'hybrid';
  const limit     = Math.min(body.limit ?? 10, 50);
  const threshold = body.threshold ?? (mode === 'recall' ? 0.65 : 0.70);

  try {
    if (mode === 'recall') {
      const results = await recallConversation(user.id, body.query, {
        limit,
        threshold,
        excludeSession: body.sessionId,
      });
      return NextResponse.json({ results, mode });
    }

    if (mode === 'semantic') {
      const results = await semanticSearch(user.id, body.query, {
        limit,
        threshold,
        memoryType: body.type,
      });
      return NextResponse.json({ results, mode });
    }

    // hybrid: semantic + keyword merged
    const results = await hybridSearch(user.id, body.query, {
      limit,
      threshold,
      memoryType: body.type,
    });
    return NextResponse.json({ results, mode });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
