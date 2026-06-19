import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/supabase-admin';
import {
  storeMemory,
  updateMemory,
  deleteMemory,
  hybridSearch,
  type MemoryType,
  type StoreMemoryOptions,
} from '@/lib/server/memory-store';
import { getAdminSupabase } from '@/lib/server/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET /api/memory?limit=20&type=conversation ────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const memoryType = searchParams.get('type') as MemoryType | null;
  const sessionId  = searchParams.get('session') ?? null;

  try {
    const sb = getAdminSupabase();
    let query = sb
      .from('memories')
      .select('id, content, summary, memory_type, importance, access_count, session_id, created_at, updated_at, metadata')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (memoryType) query = query.eq('memory_type', memoryType);
    if (sessionId)  query = query.eq('session_id', sessionId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ memories: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── POST /api/memory ─ store a memory manually ────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    content:     string;
    summary?:    string;
    sessionId?:  string;
    memoryType?: MemoryType;
    importance?: number;
    metadata?:   Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.content || typeof body.content !== 'string') {
    return NextResponse.json({ error: '`content` is required' }, { status: 400 });
  }
  if (body.content.length > 50_000) {
    return NextResponse.json({ error: '`content` exceeds 50 000 characters' }, { status: 400 });
  }
  if (body.importance !== undefined && (body.importance < 0 || body.importance > 1)) {
    return NextResponse.json({ error: '`importance` must be between 0 and 1' }, { status: 400 });
  }

  const validTypes: MemoryType[] = ['conversation', 'fact', 'preference', 'code', 'error', 'context'];
  if (body.memoryType && !validTypes.includes(body.memoryType)) {
    return NextResponse.json({ error: `Invalid memoryType. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
  }

  try {
    const opts: StoreMemoryOptions = {
      sessionId:  body.sessionId,
      summary:    body.summary,
      memoryType: body.memoryType ?? 'context',
      importance: body.importance ?? 0.5,
      metadata:   body.metadata   ?? {},
    };

    const memory = await storeMemory(user.id, body.content, opts);
    return NextResponse.json({ memory }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── PATCH /api/memory ─ update an existing memory ────────────────────────────

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    id:          string;
    content?:    string;
    summary?:    string;
    importance?: number;
    metadata?:   Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: '`id` is required' }, { status: 400 });
  }

  try {
    const memory = await updateMemory(body.id, user.id, {
      content:    body.content,
      summary:    body.summary,
      importance: body.importance,
      metadata:   body.metadata,
    });
    return NextResponse.json({ memory });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── DELETE /api/memory?id=<uuid> ─────────────────────────────────────────────

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: '`id` query param required' }, { status: 400 });

  try {
    await deleteMemory(id, user.id);
    return NextResponse.json({ deleted: id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
