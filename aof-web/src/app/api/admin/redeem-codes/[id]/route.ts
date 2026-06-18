// ── /api/admin/redeem-codes/[id] ─────────────────────────────────────────────
// GET   - Get a single code with its redeemers list.
// PATCH - Enable/disable code or update limits.
// DELETE - Delete a code (only if use_count === 0).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { logAdminAction } from "@/lib/admin/server";

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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const supabase = getAdminSupabase();
  const { data: code, error: codeErr } = await supabase
    .from("redeem_codes").select("*").eq("id", params.id).maybeSingle();
  if (codeErr || !code) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const { data: uses } = await supabase
    .from("redeem_code_uses")
    .select("user_id, redeemed_at, subscription_id")
    .eq("redeem_code_id", params.id)
    .order("redeemed_at", { ascending: false });

  const userIds = (uses ?? []).map((u) => u.user_id as string);
  const emailMap = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await supabase.auth.admin.getUserById(uid);
      if (data?.user?.email) emailMap.set(uid, data.user.email);
    })
  );

  const redeemers = (uses ?? []).map((u) => ({
    user_id: u.user_id,
    email: emailMap.get(u.user_id as string) ?? null,
    redeemed_at: u.redeemed_at,
    subscription_id: u.subscription_id,
  }));

  return NextResponse.json({ code, redeemers });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("redeem_codes").select("*").eq("id", params.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.disabled === "boolean") {
    updates.disabled_at = body.disabled ? new Date().toISOString() : null;
    updates.disabled_by = body.disabled ? caller.id : null;
  }
  if (typeof body.maxUses === "number") updates.max_uses = body.maxUses;
  if (typeof body.expiresAt === "string") updates.expires_at = body.expiresAt;
  if (typeof body.description === "string") updates.description = body.description;

  const { data: updated, error: updateErr } = await supabase
    .from("redeem_codes").update(updates).eq("id", params.id).select().single();
  if (updateErr) return NextResponse.json({ error: "update-failed", detail: updateErr.message }, { status: 500 });

  await logAdminAction(caller.id, "redeem_code.disable", params.id, "redeem_code", { updates });
  return NextResponse.json({ ok: true, code: updated });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("redeem_codes").select("use_count").eq("id", params.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (existing.use_count > 0) {
    return NextResponse.json({ error: "cannot-delete-used-code" }, { status: 409 });
  }

  const { error: delErr } = await supabase.from("redeem_codes").delete().eq("id", params.id);
  if (delErr) return NextResponse.json({ error: "delete-failed", detail: delErr.message }, { status: 500 });

  await logAdminAction(caller.id, "redeem_code.delete", params.id, "redeem_code");
  return NextResponse.json({ ok: true });
}
