-- ── Atomic increment for redeem_codes.use_count ───────────────────────────────
-- /api/admin/redeem read use_count then wrote use_count+1 from application code
-- (route.ts: `update({ use_count: redeemCode.use_count + 1 })`) — a classic
-- lost-update race: two concurrent redemptions of the same code can both read
-- the same use_count and only one increment survives, so the counter silently
-- fails to go up. Replace with a single atomic UPDATE via RPC, matching the
-- pattern already used for referral_codes.total_clicks/total_signups
-- (0005_referral_system.sql).
create or replace function public.increment_redeem_code_use_count(
  p_code_id uuid
) returns void
language plpgsql security definer as $$
begin
  update public.redeem_codes
  set use_count = use_count + 1
  where id = p_code_id;
end;
$$;

-- Called server-side only via the service-role admin client; keep it off the
-- public PostgREST surface, matching the hardening already applied in 0008.
revoke execute on function public.increment_redeem_code_use_count(uuid) from anon, authenticated;
alter function public.increment_redeem_code_use_count(uuid) set search_path = public, pg_temp;
