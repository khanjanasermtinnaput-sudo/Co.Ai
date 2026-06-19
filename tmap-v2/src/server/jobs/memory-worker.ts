// BullMQ workers: memory consolidation + pruning
import type { Job } from 'bullmq';

interface ConsolidationJobData {
  userId:       string;
  sessionId:    string;
  maxMemories?: number;
}

interface PruneJobData {
  userId?:         string; // omit for scheduled global prune
  retentionDays?:  number;
  minImportance?:  number;
  scheduled?:      boolean;
}

async function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured for memory worker');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Consolidation job ─────────────────────────────────────────────────────────
// Groups recent conversation turns in a session into long-term memory records.

export async function processConsolidationJob(
  job: Job<ConsolidationJobData>
): Promise<{ memoriesCreated: number; turnsProcessed: number }> {
  const { userId, sessionId, maxMemories = 10 } = job.data;

  const sb = await getSupabase();
  await job.updateProgress(10);

  const { data: turns, error } = await sb
    .from('conversation_turns')
    .select('id, role, content, token_count')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`consolidation fetch: ${error.message}`);
  if (!turns?.length) return { memoriesCreated: 0, turnsProcessed: 0 };

  await job.updateProgress(30);

  // Sliding window grouping: up to ~800 tokens per memory
  type TurnRow = { id: string; role: string; content: string; token_count: number | null };
  const windows: TurnRow[][] = [];
  let current: TurnRow[]    = [];
  let tokens   = 0;

  for (const t of turns as TurnRow[]) {
    const est = t.token_count ?? Math.ceil(t.content.length / 4);
    if (tokens + est > 800 && current.length) {
      windows.push(current);
      current = [];
      tokens  = 0;
    }
    current.push(t);
    tokens += est;
  }
  if (current.length) windows.push(current);

  const toCreate = windows.slice(0, maxMemories);
  let memoriesCreated = 0;

  for (let i = 0; i < toCreate.length; i++) {
    const window = toCreate[i];
    const combined   = window.map((t) => `[${t.role}]: ${t.content}`).join('\n');
    const importance = window.some((t) => t.role === 'user') ? 0.6 : 0.4;

    const { error: insertErr } = await sb.from('memories').insert({
      user_id:     userId,
      session_id:  sessionId,
      content:     combined,
      memory_type: 'conversation',
      importance,
      metadata:    { source: 'consolidation', turn_ids: window.map((t) => t.id) },
    });

    if (insertErr) {
      console.warn('[CGNTX][MemWorker] insert failed:', insertErr.message);
    } else {
      memoriesCreated++;
    }

    await job.updateProgress(30 + Math.round((60 * (i + 1)) / toCreate.length));
  }

  await job.updateProgress(100);
  return { memoriesCreated, turnsProcessed: turns.length };
}

// ── Prune job ─────────────────────────────────────────────────────────────────
// Deletes old low-importance unaccessed memories and stale turns.

export async function processPruneJob(
  job: Job<PruneJobData>
): Promise<{ memoriesDeleted: number; turnsDeleted: number; usersProcessed: number }> {
  const { userId, retentionDays = 90, minImportance = 0.3, scheduled } = job.data;
  const sb = await getSupabase();

  await job.updateProgress(5);

  // If triggered on a specific user, prune only them.
  // Scheduled global prune iterates all users who have memories.
  const userIds: string[] = [];

  if (userId) {
    userIds.push(userId);
  } else if (scheduled) {
    const { data: users } = await sb
      .from('memories')
      .select('user_id')
      .limit(500);
    const seen = new Set<string>();
    for (const row of users ?? []) {
      if (!seen.has(row.user_id)) { seen.add(row.user_id); userIds.push(row.user_id); }
    }
  }

  let memoriesDeleted = 0;
  let turnsDeleted    = 0;

  for (let i = 0; i < userIds.length; i++) {
    const uid = userIds[i];

    const { data: mdel } = await sb.rpc('prune_old_memories', {
      p_user_id:        uid,
      p_retention_days: retentionDays,
      p_min_importance: minImportance,
    });
    memoriesDeleted += (mdel as number) ?? 0;

    const { data: tdel } = await sb.rpc('prune_old_turns', {
      p_user_id:        uid,
      p_retention_days: Math.floor(retentionDays / 3),
    });
    turnsDeleted += (tdel as number) ?? 0;

    await job.updateProgress(5 + Math.round((90 * (i + 1)) / Math.max(userIds.length, 1)));
  }

  await job.updateProgress(100);
  return { memoriesDeleted, turnsDeleted, usersProcessed: userIds.length };
}
