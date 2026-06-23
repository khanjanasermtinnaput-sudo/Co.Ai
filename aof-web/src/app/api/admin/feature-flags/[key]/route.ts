// ── /api/admin/feature-flags/[key] ───────────────────────────────────────────
// PATCH  - Toggle or update a feature flag.
// DELETE - Delete a feature flag.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data: existing } = await supabase.from("feature_flags").select("*").eq("flag_key", params.key).maybeSingle();
  if (!existing) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: caller.id };
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (typeof body.description === "string") updates.description = body.description;
  if (Array.isArray(body.targetPlans)) updates.target_plans = body.targetPlans;
  if (Array.isArray(body.targetRoles)) updates.target_roles = body.targetRoles;
  if (typeof body.rolloutPct === "number") updates.rollout_pct = body.rolloutPct;

  const { data: flag, error: updateErr } = await supabase
    .from("feature_flags").update(updates).eq("flag_key", params.key).select().single();
  if (updateErr) return NextResponse.json({ error: "update-failed", detail: updateErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.feature_flag_update", params.key, "feature_flag", { updates });
  return NextResponse.json({ ok: true, flag });
}

export async function DELETE(req: Request, { params }: { params: { key: string } }) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  const supabase = getAdminSupabase();
  const { error: delErr } = await supabase.from("feature_flags").delete().eq("flag_key", params.key);
  if (delErr) return NextResponse.json({ error: "delete-failed", detail: delErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.feature_flag_update", params.key, "feature_flag", { deleted: true });
  return NextResponse.json({ ok: true });
}
