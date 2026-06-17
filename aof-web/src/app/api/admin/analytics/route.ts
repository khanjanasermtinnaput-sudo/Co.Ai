// ── /api/admin/analytics ─────────────────────────────────────────────────────
// GET - Platform analytics: user counts, tier distribution, activity stats.
// Query params: ?period=7d|30d|90d

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import type { UserTier } from "@/store/auth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "admin-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const { data } = await getAdminSupabase().from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  const role = data?.role ?? "USER";
  if (!["OWNER", "ADMIN"].includes(role)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user, role };
}

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
  while (true) {
    const { data, error: listErr } = await supabase.auth.admin.listUsers({ page: fetchPage, perPage: 1000 });
    if (listErr || !data?.users?.length) break;
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

  // 2. Active subscriptions
  const { count: activeSubs } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .is("revoked_at", null);

  // 3. Subscriptions granted in period
  const { count: newSubs } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .gte("granted_at", since);

  // 4. Redeem codes: active, total uses in period
  const { count: activeCodesCount } = await supabase
    .from("redeem_codes")
    .select("id", { count: "exact", head: true })
    .is("disabled_at", null);

  const { count: codeUses } = await supabase
    .from("redeem_code_uses")
    .select("id", { count: "exact", head: true })
    .gte("redeemed_at", since);

  // 5. Feature flags summary
  const { data: flags } = await supabase.from("feature_flags").select("flag_key, enabled");
  const enabledFlags = (flags ?? []).filter((f) => f.enabled).length;

  // 6. Announcements active
  const { count: activeAnnouncements } = await supabase
    .from("announcements")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .lte("starts_at", now.toISOString());

  // 7. Admin roles breakdown
  const { data: roles } = await supabase.from("user_roles").select("role");
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

  return NextResponse.json({
    period,
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
