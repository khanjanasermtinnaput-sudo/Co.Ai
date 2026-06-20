-- ── Admin user listing — server-side filtering + pagination (P-1) ─────────────
-- Replaces the previous "load ALL users into memory, then filter in JS" approach
-- in /api/admin/users with a single SQL query that filters and paginates in the
-- database. The API route calls this RPC and falls back to the in-memory path if
-- the function is not present, so applying this migration is safe and reversible.
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit  int := greatest(least(coalesce(p_limit, 20), 100), 1);
  v_page   int := greatest(coalesce(p_page, 1), 1);
  v_offset int := (v_page - 1) * v_limit;
  v_search text := lower(coalesce(p_search, ''));
  v_total  int;
  v_rows   jsonb;
begin
  create temporary table _filtered on commit drop as
  with base as (
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
  )
  select * from base b
  where
    ( v_search = ''
      or lower(coalesce(b.email, '')) like '%' || v_search || '%'
      or lower(coalesce(b.name, ''))  like '%' || v_search || '%'
      or b.id::text                    like '%' || v_search || '%' )
    and ( coalesce(p_role, '') = '' or b.role = p_role )
    and ( coalesce(p_plan, '') = '' or b.plan = p_plan )
    and ( coalesce(p_status, '') = ''
          or (p_status = 'banned' and b.banned_until is not null)
          or (p_status = 'active' and b.banned_until is null) );

  select count(*) into v_total from _filtered;

  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select * from _filtered
    order by created_at desc
    offset v_offset
    limit v_limit
  ) t;

  return jsonb_build_object('users', v_rows, 'total', v_total, 'page', v_page, 'limit', v_limit);
end;
$$;

revoke all on function public.admin_list_users(text, text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, text, text, int, int) to service_role;
