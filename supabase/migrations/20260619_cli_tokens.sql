-- CLI token management tables for Coagentix Code CLI (Advanced subscribers only)

-- Stores hashed CLI access tokens. Raw token is never persisted.
CREATE TABLE IF NOT EXISTS cli_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,           -- SHA-256 hex of raw token
  token_prefix  TEXT NOT NULL,                  -- first 12 chars for display (e.g. "coai_xR3k...")
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,                    -- NULL = never expires
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ                     -- NULL = active
);

CREATE INDEX IF NOT EXISTS cli_tokens_user_id_idx    ON cli_tokens (user_id);
CREATE INDEX IF NOT EXISTS cli_tokens_token_hash_idx ON cli_tokens (token_hash);

-- Tracks active CLI sessions per device (device = one `coai login` invocation)
CREATE TABLE IF NOT EXISTS cli_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id       UUID NOT NULL REFERENCES cli_tokens(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  device_name    TEXT,
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cli_sessions_token_id_idx ON cli_sessions (token_id);
CREATE INDEX IF NOT EXISTS cli_sessions_user_id_idx  ON cli_sessions (user_id);

-- Row-level security: users only see their own rows
ALTER TABLE cli_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cli_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cli_tokens: own rows only"
  ON cli_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cli_sessions: own rows only"
  ON cli_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
