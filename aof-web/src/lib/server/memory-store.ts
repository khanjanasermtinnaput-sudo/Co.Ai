// Long-term memory store — pgvector semantic retrieval + conversation recall (server-only)
import { getAdminSupabase, isAdminConfigured } from './supabase-admin.js';
import { embed, embedBatch, cosineSimilarity } from './embeddings.js';
import { cacheKey, cacheGet, cacheSet, cacheDel } from './redis.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryType = 'conversation' | 'fact' | 'preference' | 'code' | 'error' | 'context';
export type TurnRole   = 'user' | 'assistant' | 'system';

export interface Memory {
  id:            string;
  userId:        string;
  sessionId:     string | null;
  content:       string;
  summary:       string | null;
  memoryType:    MemoryType;
  importance:    number;
  accessCount:   number;
  lastAccessedAt: string | null;
  createdAt:     string;
  updatedAt:     string;
  metadata:      Record<string, unknown>;
}

export interface ConversationTurn {
  id:         string;
  userId:     string;
  sessionId:  string;
  role:       TurnRole;
  content:    string;
  tokenCount: number | null;
  createdAt:  string;
  metadata:   Record<string, unknown>;
}

export interface SearchResult {
  id:         string;
  content:    string;
  summary:    string | null;
  memoryType: MemoryType;
  importance: number;
  similarity: number;
  createdAt:  string;
  metadata:   Record<string, unknown>;
}

export interface RecallResult {
  id:        string;
  sessionId: string;
  role:      TurnRole;
  content:   string;
  similarity: number;
  createdAt: string;
}

export interface KeywordResult {
  id:         string;
  content:    string;
  summary:    string | null;
  memoryType: MemoryType;
  importance: number;
  rank:       number;
  createdAt:  string;
}

export interface StoreMemoryOptions {
  sessionId?:  string;
  summary?:    string;
  memoryType?: MemoryType;
  importance?: number;
  metadata?:   Record<string, unknown>;
}

export interface StoreTurnOptions {
  tokenCount?: number;
  metadata?:   Record<string, unknown>;
}

export interface SearchOptions {
  limit?:      number;
  threshold?:  number;
  memoryType?: MemoryType;
}

export interface RecallOptions {
  limit?:          number;
  threshold?:      number;
  excludeSession?: string;
}

// ── Cache keys ────────────────────────────────────────────────────────────────

const SEARCH_TTL = 120; // 2 min — search results are user-specific and can change

function searchCacheKey(userId: string, query: string, opts: SearchOptions): string {
  return cacheKey('mem-search', userId, Buffer.from(`${query}:${JSON.stringify(opts)}`).toString('base64').slice(0, 32));
}

// ── Guard: require Supabase ───────────────────────────────────────────────────

function requireAdmin(op: string): ReturnType<typeof getAdminSupabase> {
  if (!isAdminConfigured()) {
    throw new Error(`Memory store: Supabase admin not configured (needed for ${op})`);
  }
  return getAdminSupabase();
}

// ── Store conversation turn ───────────────────────────────────────────────────

export async function storeTurn(
  userId:    string,
  sessionId: string,
  role:      TurnRole,
  content:   string,
  opts:      StoreTurnOptions = {}
): Promise<ConversationTurn> {
  const sb = requireAdmin('storeTurn');

  const { embedding } = await embed(content);

  const { data, error } = await sb
    .from('conversation_turns')
    .insert({
      user_id:     userId,
      session_id:  sessionId,
      role,
      content,
      embedding,
      token_count: opts.tokenCount ?? null,
      metadata:    opts.metadata   ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(`storeTurn: ${error.message}`);

  return mapTurn(data);
}

export async function storeTurnsBatch(
  userId:    string,
  sessionId: string,
  turns: Array<{ role: TurnRole; content: string; tokenCount?: number; metadata?: Record<string, unknown> }>
): Promise<ConversationTurn[]> {
  if (!turns.length) return [];
  const sb = requireAdmin('storeTurnsBatch');

  const batch = await embedBatch(turns.map((t) => t.content));

  const rows = turns.map((t, i) => ({
    user_id:     userId,
    session_id:  sessionId,
    role:        t.role,
    content:     t.content,
    embedding:   batch.embeddings[i].embedding,
    token_count: t.tokenCount ?? null,
    metadata:    t.metadata   ?? {},
  }));

  const { data, error } = await sb
    .from('conversation_turns')
    .insert(rows)
    .select();

  if (error) throw new Error(`storeTurnsBatch: ${error.message}`);
  return (data ?? []).map(mapTurn);
}

// ── Store long-term memory ────────────────────────────────────────────────────

export async function storeMemory(
  userId:  string,
  content: string,
  opts:    StoreMemoryOptions = {}
): Promise<Memory> {
  const sb = requireAdmin('storeMemory');

  const { embedding } = await embed(opts.summary ?? content);

  const { data, error } = await sb
    .from('memories')
    .insert({
      user_id:    userId,
      session_id: opts.sessionId  ?? null,
      content,
      summary:    opts.summary    ?? null,
      embedding,
      memory_type: opts.memoryType ?? 'conversation',
      importance:  opts.importance ?? 0.5,
      metadata:    opts.metadata   ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(`storeMemory: ${error.message}`);

  await invalidateSearchCache(userId);
  return mapMemory(data);
}

export async function updateMemory(
  memoryId: string,
  userId:   string,
  patch: {
    content?:    string;
    summary?:    string;
    importance?: number;
    metadata?:   Record<string, unknown>;
  }
): Promise<Memory> {
  const sb = requireAdmin('updateMemory');

  const updates: Record<string, unknown> = { ...patch };
  if (patch.content || patch.summary) {
    const textToEmbed = patch.summary ?? patch.content!;
    const { embedding } = await embed(textToEmbed);
    updates.embedding = embedding;
  }

  const { data, error } = await sb
    .from('memories')
    .update(updates)
    .eq('id', memoryId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`updateMemory: ${error.message}`);
  await invalidateSearchCache(userId);
  return mapMemory(data);
}

export async function deleteMemory(memoryId: string, userId: string): Promise<void> {
  const sb = requireAdmin('deleteMemory');
  const { error } = await sb
    .from('memories')
    .delete()
    .eq('id', memoryId)
    .eq('user_id', userId);
  if (error) throw new Error(`deleteMemory: ${error.message}`);
  await invalidateSearchCache(userId);
}

// ── Semantic search ───────────────────────────────────────────────────────────

export async function semanticSearch(
  userId: string,
  query:  string,
  opts:   SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, threshold = 0.70, memoryType } = opts;

  const cKey = searchCacheKey(userId, query, opts);
  const cached = await cacheGet<SearchResult[]>(cKey);
  if (cached) return cached;

  const sb = requireAdmin('semanticSearch');
  const { embedding } = await embed(query);

  const { data, error } = await sb.rpc('semantic_search', {
    p_user_id:     userId,
    p_embedding:   embedding,
    p_limit:       limit,
    p_threshold:   threshold,
    p_memory_type: memoryType ?? null,
  });

  if (error) throw new Error(`semanticSearch: ${error.message}`);

  // Touch access counts asynchronously
  const results = (data ?? []) as SearchResult[];
  touchMemoriesAsync(sb, results.map((r) => r.id));

  await cacheSet(cKey, results, SEARCH_TTL);
  return results;
}

export async function hybridSearch(
  userId: string,
  query:  string,
  opts:   SearchOptions = {}
): Promise<SearchResult[]> {
  const [semantic, keyword] = await Promise.allSettled([
    semanticSearch(userId, query, opts),
    keywordSearch(userId, query, opts),
  ]);

  const byId = new Map<string, SearchResult>();

  if (semantic.status === 'fulfilled') {
    for (const r of semantic.value) byId.set(r.id, r);
  }

  if (keyword.status === 'fulfilled') {
    for (const r of keyword.value) {
      if (!byId.has(r.id)) {
        // Treat keyword rank as a lower-confidence similarity score
        byId.set(r.id, { ...r, similarity: r.rank * 0.6 });
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.similarity - a.similarity);
}

// ── Keyword search (fallback) ─────────────────────────────────────────────────

export async function keywordSearch(
  userId: string,
  query:  string,
  opts:   Pick<SearchOptions, 'limit' | 'memoryType'> = {}
): Promise<(KeywordResult & { similarity: number })[]> {
  const { limit = 10, memoryType } = opts;
  const sb = requireAdmin('keywordSearch');

  const { data, error } = await sb.rpc('keyword_search', {
    p_user_id:     userId,
    p_query:       query,
    p_limit:       limit,
    p_memory_type: memoryType ?? null,
  });

  if (error) throw new Error(`keywordSearch: ${error.message}`);
  return ((data ?? []) as KeywordResult[]).map((r) => ({ ...r, similarity: r.rank }));
}

// ── Conversation recall ───────────────────────────────────────────────────────

export async function recallConversation(
  userId: string,
  query:  string,
  opts:   RecallOptions = {}
): Promise<RecallResult[]> {
  const { limit = 5, threshold = 0.65, excludeSession } = opts;
  const sb = requireAdmin('recallConversation');

  const { embedding } = await embed(query);

  const { data, error } = await sb.rpc('recall_conversation', {
    p_user_id:         userId,
    p_embedding:       embedding,
    p_limit:           limit,
    p_threshold:       threshold,
    p_exclude_session: excludeSession ?? null,
  });

  if (error) throw new Error(`recallConversation: ${error.message}`);
  return (data ?? []) as RecallResult[];
}

// ── In-memory local re-rank (client-side cosine, no DB round-trip) ────────────

export async function localRerank<T extends { content: string }>(
  query:   string,
  items:   T[],
  topK:    number = 10
): Promise<Array<T & { similarity: number }>> {
  if (!items.length) return [];
  const { embedding: qEmb }  = await embed(query);
  const batch = await embedBatch(items.map((i) => i.content));
  return items
    .map((item, i) => ({
      ...item,
      similarity: cosineSimilarity(qEmb, batch.embeddings[i].embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

// ── Memory consolidation (turns → long-term memory) ───────────────────────────

export interface ConsolidationResult {
  memoriesCreated: number;
  turnsProcessed:  number;
}

export async function consolidateSession(
  userId:    string,
  sessionId: string,
  options: {
    minImportance?: number;
    maxMemories?:   number;
  } = {}
): Promise<ConsolidationResult> {
  const { minImportance = 0.4, maxMemories = 10 } = options;
  const sb = requireAdmin('consolidateSession');

  const { data: turns, error } = await sb
    .from('conversation_turns')
    .select('id, role, content, token_count')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`consolidateSession fetch: ${error.message}`);
  if (!turns?.length) return { memoriesCreated: 0, turnsProcessed: 0 };

  // Group consecutive turns into context windows
  const windows: Array<{ content: string; role: TurnRole }[]> = [];
  let current: Array<{ content: string; role: TurnRole }> = [];
  let tokens = 0;

  for (const t of turns) {
    const est = t.token_count ?? Math.ceil((t.content as string).length / 4);
    if (tokens + est > 800 && current.length) {
      windows.push(current);
      current = [];
      tokens  = 0;
    }
    current.push({ content: t.content as string, role: t.role as TurnRole });
    tokens += est;
  }
  if (current.length) windows.push(current);

  const toCreate = windows.slice(0, maxMemories);
  let memoriesCreated = 0;

  for (const window of toCreate) {
    const combined = window.map((t) => `[${t.role}]: ${t.content}`).join('\n');
    const importance = window.some((t) => t.role === 'user') ? 0.6 : minImportance;

    await storeMemory(userId, combined, {
      sessionId,
      memoryType: 'conversation',
      importance,
    });
    memoriesCreated++;
  }

  return { memoriesCreated, turnsProcessed: turns.length };
}

// ── Prune old data ────────────────────────────────────────────────────────────

export async function pruneUserMemories(
  userId:         string,
  retentionDays:  number = 90,
  minImportance:  number = 0.3
): Promise<number> {
  const sb = requireAdmin('pruneUserMemories');
  const { data, error } = await sb.rpc('prune_old_memories', {
    p_user_id:        userId,
    p_retention_days: retentionDays,
    p_min_importance: minImportance,
  });
  if (error) throw new Error(`pruneUserMemories: ${error.message}`);
  await invalidateSearchCache(userId);
  return (data as number) ?? 0;
}

export async function pruneUserTurns(
  userId:        string,
  retentionDays: number = 30
): Promise<number> {
  const sb = requireAdmin('pruneUserTurns');
  const { data, error } = await sb.rpc('prune_old_turns', {
    p_user_id:        userId,
    p_retention_days: retentionDays,
  });
  if (error) throw new Error(`pruneUserTurns: ${error.message}`);
  return (data as number) ?? 0;
}

// ── Build context string for LLM injection ────────────────────────────────────

export interface MemoryContext {
  memories: SearchResult[];
  recall:   RecallResult[];
  text:     string;
}

export async function buildMemoryContext(
  userId:    string,
  query:     string,
  sessionId: string,
  opts: { memLimit?: number; turnLimit?: number } = {}
): Promise<MemoryContext> {
  const { memLimit = 5, turnLimit = 3 } = opts;

  const [memories, recall] = await Promise.allSettled([
    semanticSearch(userId, query, { limit: memLimit, threshold: 0.68 }),
    recallConversation(userId, query, { limit: turnLimit, threshold: 0.65, excludeSession: sessionId }),
  ]);

  const memList  = memories.status === 'fulfilled' ? memories.value  : [];
  const turnList = recall.status   === 'fulfilled' ? recall.value    : [];

  const lines: string[] = [];

  if (memList.length) {
    lines.push('## Relevant memories');
    for (const m of memList) {
      lines.push(`- [${m.memoryType}] ${m.summary ?? m.content.slice(0, 200)}`);
    }
  }

  if (turnList.length) {
    lines.push('\n## Related past conversations');
    for (const t of turnList) {
      lines.push(`- [${t.role}] ${t.content.slice(0, 200)}`);
    }
  }

  return {
    memories: memList,
    recall:   turnList,
    text:     lines.join('\n'),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapMemory(row: Record<string, unknown>): Memory {
  return {
    id:             row.id             as string,
    userId:         row.user_id        as string,
    sessionId:      (row.session_id    as string | null) ?? null,
    content:        row.content        as string,
    summary:        (row.summary       as string | null) ?? null,
    memoryType:     row.memory_type    as MemoryType,
    importance:     row.importance     as number,
    accessCount:    row.access_count   as number,
    lastAccessedAt: (row.last_accessed_at as string | null) ?? null,
    createdAt:      row.created_at     as string,
    updatedAt:      row.updated_at     as string,
    metadata:       (row.metadata      as Record<string, unknown>) ?? {},
  };
}

function mapTurn(row: Record<string, unknown>): ConversationTurn {
  return {
    id:         row.id          as string,
    userId:     row.user_id     as string,
    sessionId:  row.session_id  as string,
    role:       row.role        as TurnRole,
    content:    row.content     as string,
    tokenCount: (row.token_count as number | null) ?? null,
    createdAt:  row.created_at  as string,
    metadata:   (row.metadata   as Record<string, unknown>) ?? {},
  };
}

function touchMemoriesAsync(
  sb: ReturnType<typeof getAdminSupabase>,
  ids: string[]
): void {
  for (const id of ids) {
    sb.rpc('touch_memory', { p_id: id }).then().catch();
  }
}

async function invalidateSearchCache(userId: string): Promise<void> {
  await cacheDel(cacheKey('mem-search', userId, '*'));
}
