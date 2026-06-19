-- Per-user AI provider API keys, tied to the Google account (auth.users.id).
-- The key itself is stored AES-256-GCM encrypted (server-side COAGENTIX_MASTER_KEY);
-- only a masked preview is kept in plaintext for display. RLS is enabled with NO
-- policies, so neither the anon nor the authenticated browser client can read or
-- write this table directly — all access goes through the Next.js /api/keys routes
-- using the service role key, which never returns the decrypted key to the browser.

create table if not exists public.provider_keys (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  provider      text        not null,
  encrypted_key text        not null,
  key_preview   text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.provider_keys enable row level security;
