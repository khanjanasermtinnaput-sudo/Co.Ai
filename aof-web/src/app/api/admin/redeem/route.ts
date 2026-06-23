// ── /api/admin/redeem ─────────────────────────────────────────────────────────
// POST - User-facing endpoint to redeem a subscription code.
// Any authenticated user can call this.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { logAdminAction } from "@/lib/admin/server";
import { parseJsonBody } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "service-unavailable" }, { status: 503 });
  }

  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = await parseJsonBody(req, z.object({ code: z.string().min(1).max(64) }));
  if (parsed.error) return parsed.error;
  const code = parsed.data.code.trim().toUpperCase();

  const supabase = getAdminSupabase();

  // Look up the code
  const { data: redeemCode, error: codeErr } = await supabase
    .from("redeem_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (codeErr || !redeemCode) {
    return NextResponse.json({ error: "invalid-code" }, { status: 404 });
  }

  // Check if disabled
  if (redeemCode.disabled_at) {
    return NextResponse.json({ error: "code-disabled" }, { status: 410 });
  }

  // Check expiry
  if (redeemCode.expires_at && new Date(redeemCode.expires_at) < new Date()) {
    return NextResponse.json({ error: "code-expired" }, { status: 410 });
  }

  // Check usage limit
  if (redeemCode.max_uses !== null && redeemCode.use_count >= redeemCode.max_uses) {
    return NextResponse.json({ error: "code-limit-reached" }, { status: 410 });
  }

  // Check single-use-per-user
  if (redeemCode.single_use_per_user) {
    const { data: existing } = await supabase
      .from("redeem_code_uses")
      .select("id")
      .eq("redeem_code_id", redeemCode.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) return NextResponse.json({ error: "already-redeemed" }, { status: 409 });
  }

  // Calculate expiry for subscription
  const expiresAt = redeemCode.duration_days
    ? new Date(Date.now() + redeemCode.duration_days * 86_400_000).toISOString()
    : null;

  // Create subscription
  const { data: subscription, error: subErr } = await supabase
    .from("subscriptions")
    .insert({
      user_id: user.id,
      plan: redeemCode.plan,
      source: "redeem-code",
      redeem_code_id: redeemCode.id,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt,
      notes: `Redeemed code: ${redeemCode.code}`,
    })
    .select()
    .single();

  if (subErr) {
    return NextResponse.json({ error: "subscription-failed", detail: subErr.message }, { status: 500 });
  }

  // Record the use
  await supabase.from("redeem_code_uses").insert({
    redeem_code_id: redeemCode.id,
    user_id: user.id,
    redeemed_at: new Date().toISOString(),
    subscription_id: subscription.id,
  });

  // Increment use_count
  await supabase.from("redeem_codes").update({ use_count: redeemCode.use_count + 1 }).eq("id", redeemCode.id);

  // Update app_metadata.tier
  const { data: authUser } = await supabase.auth.admin.getUserById(user.id);
  await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(authUser?.user?.app_metadata ?? {}), tier: redeemCode.plan },
  });

  await logAdminAction(user.id, "redeem_code.use", redeemCode.id, "redeem_code", {
    code: redeemCode.code, plan: redeemCode.plan, expiresAt,
  });

  return NextResponse.json({
    ok: true,
    plan: redeemCode.plan,
    expiresAt,
    subscription,
  });
}
