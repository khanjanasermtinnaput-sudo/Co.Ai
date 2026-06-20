-- ── Admin System Migration ────────────────────────────────────────────────────
-- Creates all tables needed for the Aof Admin Dashboard.
-- All tables have RLS enabled with NO policies — every access goes through
-- Next.js API routes using the service-role key (supabase-admin.ts).
--
-- Creation order avoids forward-reference issues:
--   1. user_roles
--   2. redeem_codes          (no upstream deps beyond auth.users)
--   3. subscriptions         (references redeem_codes)
--   4. redeem_code_uses      (references redeem_codes + subscriptions)
--   5. beta_access
--   6. feature_flags
--   7. system_logs
--   8. announcements
--   9. api_usage_metrics

-- ── 1. user_roles ─────────────────────────────────────────────────────────────
-- Stores elevated roles only. Absence of a row = implicit USER role.
-- Only one OWNER row is expected; enforced at the application layer.
-- role values: OWNER | ADMIN | STAFF | BETA_TESTER
create table if not exists public.user_roles (
  id          uuid        not null default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        text        not null check (role in ('OWNER', 'ADMIN', 'STAFF', 'BETA_TESTER')),
  -- who granted this role and when
  granted_by  uuid        references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  -- optional expiry — null means the role never expires
  expires_at  timestamptz,
  notes       text,
  -- one elevated role per user; update the row to change role
  unique (user_id)
);

alter table public.user_roles enable row level security;

-- ── 2. redeem_codes ───────────────────────────────────────────────────────────
-- Subscription redemption codes that users can enter to activate a plan.
-- Created before subscriptions so that subscriptions can reference it.
create table if not exists public.redeem_codes (
  id                  uuid        not null default gen_random_uuid() primary key,
  -- the code string the user types in (case-insensitive comparisons done in app)
  code                text        not null unique,
  description         text,
  -- which plan this code activates
  plan                text        not null check (plan in ('FREE', 'LITE', 'PRO', 'ADVANCED')),
  -- how many days the subscription lasts after redeeming (null = lifetime)
  duration_days       integer,
  -- max times this code can be redeemed total (null = unlimited)
  max_uses            integer,
  -- denormalised counter; the source of truth is redeem_code_uses.count
  use_count           integer     not null default 0,
  -- whether each user can only redeem this code once (almost always true)
  single_use_per_user boolean     not null default true,
  created_by          uuid        references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  -- null = code never expires regardless of redemptions
  expires_at          timestamptz,
  -- soft-delete / disable without losing history
  disabled_at         timestamptz,
  disabled_by         uuid        references auth.users(id) on delete set null
);

alter table public.redeem_codes enable row level security;

-- ── 3. subscriptions ──────────────────────────────────────────────────────────
-- Admin-granted subscription records. The canonical plan is still stored in
-- auth.users.app_metadata.tier; this table is the source of truth for *why*
-- a user has a particular tier so support staff can see the history.
create table if not exists public.subscriptions (
  id              uuid        not null default gen_random_uuid() primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  plan            text        not null check (plan in ('FREE', 'LITE', 'PRO', 'ADVANCED')),
  -- how the subscription was granted (manual, redeem-code, payment, etc.)
  source          text        not null default 'manual',
  -- nullable: filled when granted via a redeem code
  redeem_code_id  uuid        references public.redeem_codes(id) on delete set null,
  -- who performed the grant (null when automated / self-serve)
  granted_by      uuid        references auth.users(id) on delete set null,
  granted_at      timestamptz not null default now(),
  -- null = lifetime grant
  expires_at      timestamptz,
  -- when the subscription was cancelled/revoked (null = still active)
  revoked_at      timestamptz,
  revoked_by      uuid        references auth.users(id) on delete set null,
  notes           text
);

alter table public.subscriptions enable row level security;

create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
-- Fast active-subscription lookups
create index if not exists subscriptions_active_idx  on public.subscriptions(user_id) where revoked_at is null;

-- ── 4. redeem_code_uses ───────────────────────────────────────────────────────
-- Append-only log of every successful code redemption.
-- The unique constraint on (redeem_code_id, user_id) enforces single_use_per_user
-- at the database level as a safety net on top of the application-layer check.
create table if not exists public.redeem_code_uses (
  id              uuid        not null default gen_random_uuid() primary key,
  redeem_code_id  uuid        not null references public.redeem_codes(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  redeemed_at     timestamptz not null default now(),
  -- subscription row created as a result of this redemption
  subscription_id uuid        references public.subscriptions(id) on delete set null,
  unique (redeem_code_id, user_id)
);

alter table public.redeem_code_uses enable row level security;

create index if not exists redeem_code_uses_user_idx on public.redeem_code_uses(user_id);
create index if not exists redeem_code_uses_code_idx on public.redeem_code_uses(redeem_code_id);

-- ── 5. beta_access ────────────────────────────────────────────────────────────
-- Per-user beta feature grants. A row here means the user has been granted access.
-- Features: titan-beta | cli-beta | aof-code-beta | experimental-models | early-access
create table if not exists public.beta_access (
  id          uuid        not null default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  feature     text        not null check (feature in (
                'titan-beta',
                'cli-beta',
                'aof-code-beta',
                'experimental-models',
                'early-access'
              )),
  granted_by  uuid        references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  -- null = never expires
  expires_at  timestamptz,
  notes       text,
  -- one grant per (user, feature) pair
  unique (user_id, feature)
);

alter table public.beta_access enable row level security;

create index if not exists beta_access_user_idx on public.beta_access(user_id);

-- ── 6. feature_flags ──────────────────────────────────────────────────────────
-- Platform-wide feature toggles. Optional targeting by plan tier and/or admin role.
-- When both targets are null the flag applies to all users (within rollout_pct).
create table if not exists public.feature_flags (
  id           uuid        not null default gen_random_uuid() primary key,
  -- machine-readable key used in code (e.g. "new-chat-ui", "titan-v2")
  flag_key     text        not null unique,
  description  text,
  -- whether the flag is currently active
  enabled      boolean     not null default false,
  -- JSON arrays of tier/role values this flag targets (null = all users)
  -- example: target_plans: ["PRO","ADVANCED"], target_roles: ["OWNER","ADMIN"]
  target_plans jsonb,
  target_roles jsonb,
  -- percentage rollout 0–100; null is treated as 100% for the targeted group
  rollout_pct  integer     check (rollout_pct between 0 and 100),
  created_by   uuid        references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references auth.users(id) on delete set null
);

alter table public.feature_flags enable row level security;

-- ── 7. system_logs ────────────────────────────────────────────────────────────
-- Append-only audit trail. Covers: user logins, subscription changes, code
-- redemptions, API errors, admin actions, and any other significant events.
-- Rows are never updated or deleted — this is an immutable audit log.
--
-- action naming convention: <category>.<verb>
--   user.*            — user.login, user.signup, user.delete …
--   subscription.*    — subscription.grant, subscription.revoke …
--   redeem_code.*     — redeem_code.create, redeem_code.use, redeem_code.disable …
--   beta.*            — beta.grant, beta.revoke …
--   api.*             — api.error, api.rate_limit, api.provider_fail …
--   admin.*           — admin.role_grant, admin.feature_flag_update …
--
-- severity: info | warning | error | critical
create table if not exists public.system_logs (
  id           uuid        not null default gen_random_uuid() primary key,
  -- who performed the action (null = system / automated process)
  actor_id     uuid        references auth.users(id) on delete set null,
  -- categorised action label (see naming convention above)
  action       text        not null,
  -- optional subject of the action
  target_id    text,
  -- e.g. "user", "subscription", "redeem_code", "feature_flag"
  target_type  text,
  -- structured payload for any additional event context
  metadata     jsonb,
  severity     text        not null default 'info'
                           check (severity in ('info', 'warning', 'error', 'critical')),
  created_at   timestamptz not null default now()
);

alter table public.system_logs enable row level security;

-- Index for the most common admin dashboard query patterns
create index if not exists system_logs_actor_idx      on public.system_logs(actor_id);
create index if not exists system_logs_action_idx     on public.system_logs(action);
create index if not exists system_logs_severity_idx   on public.system_logs(severity);
create index if not exists system_logs_created_at_idx on public.system_logs(created_at desc);
create index if not exists system_logs_target_idx     on public.system_logs(target_id, target_type);

-- ── 8. announcements ──────────────────────────────────────────────────────────
-- Platform-wide messages displayed in specified app locations to targeted tiers.
-- type:     maintenance | feature | beta | promotion | info
-- show_on:  JSON array of "homepage" | "dashboard" | "chat" | "aof-code"
-- target_tiers: JSON array of UserTier values; null = show to everyone
create table if not exists public.announcements (
  id            uuid        not null default gen_random_uuid() primary key,
  title         text        not null,
  body          text        not null,
  type          text        not null default 'info'
                            check (type in ('maintenance', 'feature', 'beta', 'promotion', 'info')),
  -- JSON array — which surfaces render this announcement
  show_on       jsonb       not null default '["homepage"]',
  -- JSON array — null means show to all tiers
  target_tiers  jsonb,
  -- optional call-to-action button
  cta_label     text,
  cta_url       text,
  -- whether users can dismiss this announcement
  dismissable   boolean     not null default true,
  -- scheduling window; starts_at defaults to now so it is immediately live
  starts_at     timestamptz not null default now(),
  -- null = never expires
  ends_at       timestamptz,
  -- soft-delete; set to false to hide without losing the record
  active        boolean     not null default true,
  created_by    uuid        references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.announcements enable row level security;

-- Index for the "load active announcements for this location" query
create index if not exists announcements_active_idx on public.announcements(active, starts_at, ends_at);

-- ── 9. api_usage_metrics ──────────────────────────────────────────────────────
-- Per-request AI provider usage stats, written at the end of every chat / code
-- completion. Used for cost tracking, rate-limit analytics, and error reporting.
-- Rows are insert-only; never updated.
create table if not exists public.api_usage_metrics (
  id                uuid        not null default gen_random_uuid() primary key,
  -- null = guest / unauthenticated request
  user_id           uuid        references auth.users(id) on delete set null,
  -- provider slug, e.g. "openrouter", "gemini", "deepseek"
  provider          text        not null,
  -- model identifier as passed to the provider
  model             text        not null,
  -- token counts (null when the provider does not report them)
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  -- estimated cost in USD (null when unknown / not reported)
  cost_usd          numeric(10, 6),
  -- end-to-end wall-clock latency in milliseconds
  latency_ms        integer,
  -- whether the request completed successfully
  success           boolean     not null default true,
  -- error classification when success = false
  error_code        text,
  error_message     text,
  -- which Aof feature triggered the request (e.g. "chat", "aof-code", "titan")
  feature           text,
  -- route_target from the Aof router (e.g. "chat", "code", "search")
  route_target      text,
  created_at        timestamptz not null default now()
);

alter table public.api_usage_metrics enable row level security;

-- Hot query paths: per-user usage dashboard, per-provider analytics, time-range reports
create index if not exists api_usage_metrics_user_idx     on public.api_usage_metrics(user_id);
create index if not exists api_usage_metrics_provider_idx on public.api_usage_metrics(provider, model);
create index if not exists api_usage_metrics_created_idx  on public.api_usage_metrics(created_at desc);
-- Fast lookup of failed requests for error dashboards
create index if not exists api_usage_metrics_errors_idx   on public.api_usage_metrics(success, created_at desc) where success = false;
