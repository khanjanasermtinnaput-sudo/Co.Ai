// ── /api/admin/analytics ─────────────────────────────────────────────────────
// GET - Platform analytics: user counts, tier distribution, activity stats.
// Query params: ?period=7d|30d|90d

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import type { UserTier } from "@/store/auth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function GET(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") ?? "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = getAdminSupabase();

  // 1. Total user count + tier distribution
  let allUsers: import("@supabase/supabase-js").User[] = [];
  let fetchPage = 1;
  let usersTruncated = false;
  while (true) {
    const { data, error: listErr } = await supabase.auth.admin.listUsers({ page: fetchPage, perPage: 1000 });
    if (listErr) {
      console.error("[/api/admin/analytics] listUsers failed:", listErr.message, { page: fetchPage });
      usersTruncated = true;
      break;
    }
    if (!data?.users?.length) break;
    allUsers = allUsers.concat(data.users);
    if (data.users.length < 1000) break;
    fetchPage++;
  }

  const totalUsers = allUsers.length;
  const now = new Date();
  const sinceDate = new Date(since);
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const newUsers = allUsers.filter((u) => new Date(u.created_at) >= sinceDate).length;
  const activeUsers = allUsers.filter(
    (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= sinceDate
  ).length;
  const activeUsers7d = allUsers.filter(
    (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= since7d
  ).length;

  // Tier distribution from app_metadata
  const tierCounts: Record<string, number> = { GUEST: 0, FREE: 0, LITE: 0, PRO: 0, ADVANCED: 0 };
  for (const u of allUsers) {
    const tier = ((u.app_metadata?.tier as string) ?? "FREE").toUpperCase();
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }
  const tierDistribution = (["FREE", "LITE", "PRO", "ADVANCED"] as UserTier[]).map((tier) => ({
    tier,
    count: tierCounts[tier] ?? 0,
    pct: totalUsers > 0 ? Math.round(((tierCounts[tier] ?? 0) / totalUsers) * 100) : 0,
  }));

  // Every count/select below is logged on failure rather than silently
  // reported as 0/empty — a failed query previously looked identical to a
  // genuinely-empty table from the client's perspective.
  const failedQueries: string[] = [];
  function logQueryError(label: string, err: { message: string } | null) {
    if (!err) return;
    console.error(`[/api/admin/analytics] ${label} failed:`, err.message);
    failedQueries.push(label);
  }

  // 2. Active subscriptions
  const { count: activeSubs, error: activeSubsErr } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .is("revoked_at", null);
  logQueryError("subscriptions(active)", activeSubsErr);

  // 3. Subscriptions granted in period
  const { count: newSubs, error: newSubsErr } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .gte("granted_at", since);
  logQueryError("subscriptions(new)", newSubsErr);

  // 4. Redeem codes: active, total uses in period
  const { count: activeCodesCount, error: activeCodesErr } = await supabase
    .from("redeem_codes")
    .select("id", { count: "exact", head: true })
    .is("disabled_at", null);
  logQueryError("redeem_codes(active)", activeCodesErr);

  const { count: codeUses, error: codeUsesErr } = await supabase
    .from("redeem_code_uses")
    .select("id", { count: "exact", head: true })
    .gte("redeemed_at", since);
  logQueryError("redeem_code_uses", codeUsesErr);

  // 5. Feature flags summary
  const { data: flags, error: flagsErr } = await supabase.from("feature_flags").select("flag_key, enabled");
  logQueryError("feature_flags", flagsErr);
  const enabledFlags = (flags ?? []).filter((f) => f.enabled).length;

  // 6. Announcements active
  const { count: activeAnnouncements, error: announcementsErr } = await supabase
    .from("announcements")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .lte("starts_at", now.toISOString());
  logQueryError("announcements", announcementsErr);

  // 7. Admin roles breakdown
  const { data: roles, error: rolesErr } = await supabase.from("user_roles").select("role");
  logQueryError("user_roles", rolesErr);
  const roleCounts: Record<string, number> = {};
  for (const r of roles ?? []) roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1;

  // 8. Daily new users chart (last 14 days)
  const dailyNewUsers: Array<{ date: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = new Date(Date.now() - i * 86_400_000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    dailyNewUsers.push({
      date: dayStart.toISOString().split("T")[0],
      count: allUsers.filter(
        (u) => new Date(u.created_at) >= dayStart && new Date(u.created_at) < dayEnd
      ).length,
    });
  }

  if (usersTruncated || failedQueries.length > 0) {
    console.error(
      "[/api/admin/analytics] response is degraded — some values may be incomplete:",
      { usersTruncated, failedQueries },
    );
  }

  return NextResponse.json({
    period,
    // Present whenever any underlying query failed, so the client can show
    // a "data may be incomplete" indicator instead of trusting 0/[] as real.
    degraded: usersTruncated || failedQueries.length > 0 ? { usersTruncated, failedQueries } : undefined,
    totalUsers,
    newUsers,
    activeUsers,
    activeUsers7d,
    activeSubs: activeSubs ?? 0,
    newSubs: newSubs ?? 0,
    activeCodes: activeCodesCount ?? 0,
    codeUsesInPeriod: codeUses ?? 0,
    enabledFlags,
    activeAnnouncements: activeAnnouncements ?? 0,
    tierDistribution,
    roleCounts,
    dailyNewUsers,
  });
}
