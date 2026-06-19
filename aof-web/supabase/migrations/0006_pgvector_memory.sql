-- 0006_pgvector_memory
-- Vector memory system: long-term memory, conversation recall, semantic search.
-- Requires the pgvector extension (enable in Supabase dashboard → Extensions → vector).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memories (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id       TEXT,
  content          TEXT         NOT NULL,
  summary          TEXT,
  embedding        VECTOR(1536),
  metadata         JSONB        NOT NULL DEFAULT '{}',
  memory_type      TEXT         NOT NULL DEFAULT 'conversation',
  importance       REAL         NOT NULL DEFAULT 0.5,
  access_count     INTEGER      NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT memories_importance_range CHECK (importance BETWEEN 0.0 AND 1.0),
  CONSTRAINT memories_type_check CHECK (
    memory_type IN ('conversation', 'fact', 'preference', 'code', 'error', 'context')
  )
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id   TEXT         NOT NULL,
  role         TEXT         NOT NULL,
  content      TEXT         NOT NULL,
  embedding    VECTOR(1536),
  token_count  INTEGER,
  metadata     JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT turns_role_check CHECK (role IN ('user', 'assistant', 'system'))
);

-- Shared content-addressable embedding cache (model + content → vector)
CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash     TEXT         PRIMARY KEY,
  content_preview  TEXT,
  embedding        VECTOR(1536) NOT NULL,
  model            TEXT         NOT NULL DEFAULT 'text-embedding-3-small',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS memories_emb_hnsw_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS conv_turns_emb_hnsw_idx
  ON conversation_turns USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS memories_user_created_idx ON memories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memories_session_idx ON memories (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS memories_type_idx ON memories (memory_type);
CREATE INDEX IF NOT EXISTS conv_turns_user_session_idx ON conversation_turns (user_id, session_id);
CREATE INDEX IF NOT EXISTS conv_turns_created_idx ON conversation_turns (created_at DESC);

CREATE INDEX IF NOT EXISTS memories_fts_idx
  ON memories USING gin (to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS conv_turns_fts_idx
  ON conversation_turns USING gin (to_tsvector('english', content));

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE memories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_cache    ENABLE ROW LEVEL SECURITY;

CREATE POLICY memories_own
  ON memories FOR ALL USING (auth.uid() = user_id);

CREATE POLICY conv_turns_own
  ON conversation_turns FOR ALL USING (auth.uid() = user_id);

CREATE POLICY embedding_cache_read
  ON embedding_cache FOR SELECT USING (auth.role() = 'authenticated');

-- Service role bypasses RLS so API routes can write on behalf of any user
CREATE POLICY memories_service
  ON memories FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY conv_turns_service
  ON conversation_turns FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY embedding_cache_service
  ON embedding_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Trigger: updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memories_updated_at ON memories;
CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Functions ─────────────────────────────────────────────────────────────────

-- semantic_search: cosine-similarity search over memories, blended with importance
CREATE OR REPLACE FUNCTION semantic_search(
  p_user_id     UUID,
  p_embedding   VECTOR(1536),
  p_limit       INTEGER DEFAULT 10,
  p_threshold   REAL    DEFAULT 0.70,
  p_memory_type TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id           UUID,
  content      TEXT,
  summary      TEXT,
  memory_type  TEXT,
  importance   REAL,
  similarity   REAL,
  created_at   TIMESTAMPTZ,
  metadata     JSONB
)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    m.id,
    m.content,
    m.summary,
    m.memory_type,
    m.importance,
    (1 - (m.embedding <=> p_embedding))::REAL           AS similarity,
    m.created_at,
    m.metadata
  FROM memories m
  WHERE
    m.user_id   = p_user_id
    AND m.embedding IS NOT NULL
    AND (1 - (m.embedding <=> p_embedding)) >= p_threshold
    AND (p_memory_type IS NULL OR m.memory_type = p_memory_type)
  ORDER BY
    ((1 - (m.embedding <=> p_embedding)) * 0.8 + m.importance * 0.2) DESC
  LIMIT p_limit;
$$;

-- recall_conversation: find similar turns from past sessions
CREATE OR REPLACE FUNCTION recall_conversation(
  p_user_id         UUID,
  p_embedding       VECTOR(1536),
  p_limit           INTEGER DEFAULT 5,
  p_threshold       REAL    DEFAULT 0.65,
  p_exclude_session TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  session_id  TEXT,
  role        TEXT,
  content     TEXT,
  similarity  REAL,
  created_at  TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    ct.id,
    ct.session_id,
    ct.role,
    ct.content,
    (1 - (ct.embedding <=> p_embedding))::REAL AS similarity,
    ct.created_at
  FROM conversation_turns ct
  WHERE
    ct.user_id  = p_user_id
    AND ct.embedding IS NOT NULL
    AND (1 - (ct.embedding <=> p_embedding)) >= p_threshold
    AND (p_exclude_session IS NULL OR ct.session_id != p_exclude_session)
  ORDER BY ct.embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- keyword_search: full-text fallback when no embedding is provided
CREATE OR REPLACE FUNCTION keyword_search(
  p_user_id     UUID,
  p_query       TEXT,
  p_limit       INTEGER DEFAULT 10,
  p_memory_type TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id           UUID,
  content      TEXT,
  summary      TEXT,
  memory_type  TEXT,
  importance   REAL,
  rank         REAL,
  created_at   TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    m.id,
    m.content,
    m.summary,
    m.memory_type,
    m.importance,
    ts_rank(to_tsvector('english', m.content),
            plainto_tsquery('english', p_query))::REAL AS rank,
    m.created_at
  FROM memories m
  WHERE
    m.user_id = p_user_id
    AND to_tsvector('english', m.content) @@ plainto_tsquery('english', p_query)
    AND (p_memory_type IS NULL OR m.memory_type = p_memory_type)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT p_limit;
$$;

-- touch_memory: atomically increment access counter
CREATE OR REPLACE FUNCTION touch_memory(p_id UUID)
RETURNS void LANGUAGE SQL SECURITY DEFINER AS $$
  UPDATE memories
  SET access_count = access_count + 1, last_accessed_at = NOW()
  WHERE id = p_id;
$$;

-- prune_old_memories: scheduled cleanup — remove stale low-importance unaccessed memories
CREATE OR REPLACE FUNCTION prune_old_memories(
  p_user_id        UUID,
  p_retention_days INTEGER DEFAULT 90,
  p_min_importance REAL    DEFAULT 0.3
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM memories
  WHERE
    user_id      = p_user_id
    AND created_at < NOW() - (p_retention_days || ' days')::INTERVAL
    AND importance  < p_min_importance
    AND access_count = 0;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- prune_old_turns: remove conversation turns older than the given window
CREATE OR REPLACE FUNCTION prune_old_turns(
  p_user_id        UUID,
  p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM conversation_turns
  WHERE
    user_id    = p_user_id
    AND created_at < NOW() - (p_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
