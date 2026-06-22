-- Webhooks durable storage — Round 2 #7.
-- Replaces the per-instance /tmp JSON files (lost on redeploy/cold start) with
-- Postgres tables. Accessed via PostgREST using the service-role key from the
-- tmap-v2 backend (RLS enabled, no public policies).

-- ── webhooks ──────────────────────────────────────────────────────────────────
create table if not exists public.webhooks (
  id               uuid        not null primary key,
  user_id          text        not null,
  url              text        not null,
  events           jsonb       not null default '[]',
  -- AES-256-GCM ciphertext of the signing secret; raw secret is shown once only.
  encrypted_secret text        not null,
  prefix           text        not null,
  active           boolean     not null default true,
  created_at       timestamptz not null default now(),
  last_delivery    timestamptz,
  failure_count    integer     not null default 0
);

alter table public.webhooks enable row level security;

create index if not exists webhooks_user_idx   on public.webhooks(user_id);
create index if not exists webhooks_active_idx  on public.webhooks(user_id) where active;

-- ── webhook_deliveries ─────────────────────────────────────────────────────────
-- Append-only delivery log + dead-letter queue. status = delivered | failed | dead.
-- 'dead' rows are deliveries that exhausted all retries (the DLQ).
create table if not exists public.webhook_deliveries (
  id          uuid        not null primary key,
  webhook_id  uuid        not null,
  user_id     text        not null,
  event       text        not null,
  status      text        not null check (status in ('delivered', 'failed', 'dead')),
  attempts    integer     not null default 1,
  last_error  text,
  at          timestamptz not null default now()
);

alter table public.webhook_deliveries enable row level security;

create index if not exists webhook_deliveries_webhook_idx on public.webhook_deliveries(webhook_id);
create index if not exists webhook_deliveries_user_idx    on public.webhook_deliveries(user_id);
create index if not exists webhook_deliveries_dead_idx    on public.webhook_deliveries(status, at desc) where status = 'dead';
