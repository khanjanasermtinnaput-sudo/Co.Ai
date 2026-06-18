// ── /api/admin/subscriptions ──────────────────────────────────────────────────
// GET  - List all subscriptions (active + historical) with user info.
// POST - Grant a subscription to a user.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getCallerRole(userId: string): Promise<string> {
  const { data } = await getAdminSupabase()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();
  return data?.role ?? "USER";
}

async function requireAdmin(req: Request) {
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "admin-not-configured" }, { status: 503 }) };
  }
  const user = await getUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const role = await getCallerRole(user.id);
  if (!["OWNER", "ADMIN"].includes(role)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user, role };
}

export async function GET(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const activeOnly = searchParams.get("active") !== "false";

  const supabase = getAdminSupabase();

  let query = supabase
    .from("subscriptions")
    .select("*", { count: "exact" })
    .order("granted_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (activeOnly) {
    query = query.is("revoked_at", null);
  }

  const { data: subs, error: dbErr, count } = await query;
  if (dbErr) {
    return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });
  }

  // Enrich with auth user emails for display
  const userIds = [...new Set((subs ?? []).map((s) => s.user_id as string))];
  const emailMap = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 50) {
    const batch = userIds.slice(i, i + 50);
    // auth.admin.listUsers doesn't support IN filter; query profiles separately
    // via a join-like approach: fetch each in parallel (batched)
    await Promise.all(
      batch.map(async (uid) => {
        const { data } = await supabase.auth.admin.getUserById(uid);
        if (data?.user?.email) emailMap.set(uid, data.user.email);
      })
    );
  }

  const enriched = (subs ?? []).map((s) => ({
    ...s,
    userEmail: emailMap.get(s.user_id as string) ?? null,
  }));

  return NextResponse.json({
    subscriptions: enriched,
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}

export async function POST(req: Request) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { userId, plan, durationDays, isLifetime, grantReason } = body as {
    userId?: string;
    plan?: string;
    durationDays?: number;
    isLifetime?: boolean;
    grantReason?: string;
  };

  if (!userId || typeof userId !== "string") {
    return NextResponse.json({ error: "userId-required" }, { status: 400 });
  }

  const VALID_PLANS = ["FREE", "LITE", "PRO", "ADVANCED"];
  if (!plan || !VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: "invalid-plan", validPlans: VALID_PLANS }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  // Verify user exists
  const { data: targetData, error: findErr } = await supabase.auth.admin.getUserById(userId);
  if (findErr || !targetData?.user) {
    return NextResponse.json({ error: "user-not-found" }, { status: 404 });
  }

  let expiresAt: string | null = null;
  if (!isLifetime && durationDays && durationDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() + durationDays);
    expiresAt = d.toISOString();
  }

  // Insert subscription record
  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .insert({
      user_id:    userId,
      plan,
      source:     "manual",
      granted_by: caller.id,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt,
      notes:      grantReason ?? null,
    })
    .select()
    .single();

  if (subErr) {
    return NextResponse.json({ error: "subscription-insert-failed", detail: subErr.message }, { status: 500 });
  }

  // Update auth.users app_metadata.tier
  const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...(targetData.user.app_metadata ?? {}),
      tier: plan,
    },
  });
  if (metaErr) {
    // Non-fatal but log it
    console.error("Failed to update app_metadata.tier:", metaErr.message);
  }

  // Log the action
  await supabase.from("system_logs").insert({
    actor_id:    caller.id,
    action:      "admin.subscription.grant",
    target_id:   userId,
    target_type: "user",
    metadata: {
      plan,
      durationDays: durationDays ?? null,
      isLifetime:   isLifetime ?? false,
      expiresAt,
      grantReason:  grantReason ?? null,
      subscriptionId: sub.id,
    },
    severity: "info",
  });

  return NextResponse.json({ ok: true, subscription: sub }, { status: 201 });
}
