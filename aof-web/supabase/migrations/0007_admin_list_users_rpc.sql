-- ── Admin user listing — server-side filtering + pagination (P-1) ─────────────
-- Replaces the previous "load ALL users into memory, then filter in JS" approach
-- in /api/admin/users with a single SQL query that filters and paginates in the
-- database. The API route calls this RPC and falls back to the in-memory path if
-- the function is not present, so applying this migration is safe and reversible.
--
-- Implemented as a pure CTE (no temp table) so it is safe to call multiple times
-- within one transaction / transaction-pooled connection.
--
-- SECURITY DEFINER is required to read auth.users. Execute is granted ONLY to
-- service_role (the route uses the service-role client); anon/authenticated must
-- never be able to call it.

create or replace function public.admin_list_users(
  p_search text default '',
  p_role   text default '',
  p_plan   text default '',
  p_status text default '',
  p_page   int  default 1,
  p_limit  int  default 20
) returns jsonb
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      greatest(least(coalesce(p_limit, 20), 100), 1) as lim,
      greatest(coalesce(p_page, 1), 1)               as pg,
      lower(coalesce(p_search, ''))                  as q
  ),
  base as (
    select
      u.id,
      u.email,
      u.raw_user_meta_data->>'name'        as name,
      u.raw_user_meta_data->>'avatar_url'  as avatar_url,
      coalesce(r.role, 'USER')             as role,
      r.expires_at                         as role_expires_at,
      coalesce(s.plan, u.raw_app_meta_data->>'tier', 'FREE') as plan,
      s.expires_at                         as plan_expires_at,
      u.banned_until,
      u.created_at,
      u.last_sign_in_at
    from auth.users u
    left join public.user_roles r on r.user_id = u.id
    left join lateral (
      select plan, expires_at
      from public.subscriptions
      where user_id = u.id and revoked_at is null
      order by granted_at desc
      limit 1
    ) s on true
  ),
  filtered as (
    select b.* from base b, params p
    where
      ( p.q = ''
        or lower(coalesce(b.email, '')) like '%' || p.q || '%'
        or lower(coalesce(b.name, ''))  like '%' || p.q || '%'
        or b.id::text                    like '%' || p.q || '%' )
      and ( coalesce(p_role, '') = '' or b.role = p_role )
      and ( coalesce(p_plan, '') = '' or b.plan = p_plan )
      and ( coalesce(p_status, '') = ''
            or (p_status = 'banned' and b.banned_until is not null)
            or (p_status = 'active' and b.banned_until is null) )
  ),
  page_rows as (
    select f.* from filtered f
    order by f.created_at desc
    offset (select (pg - 1) * lim from params)
    limit  (select lim from params)
  )
  select jsonb_build_object(
    'users', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.created_at desc) from page_rows pr), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page',  (select pg from params),
    'limit', (select lim from params)
  );
$$;

revoke all on function public.admin_list_users(text, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, text, text, int, int) to service_role;
