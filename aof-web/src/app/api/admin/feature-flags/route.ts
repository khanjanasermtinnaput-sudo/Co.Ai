// ── /api/admin/feature-flags ─────────────────────────────────────────────────
// GET  - List all feature flags.
// POST - Create or upsert a feature flag.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function GET(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { data: flags, error: dbErr } = await getAdminSupabase()
    .from("feature_flags")
    .select("*")
    .order("flag_key", { ascending: true });

  if (dbErr) return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });
  return NextResponse.json({ flags: flags ?? [] });
}

export async function POST(req: Request) {
  const { user: caller, error } = await requireAdmin(req);
  if (error) return error;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { flagKey, description, enabled, targetPlans, targetRoles, rolloutPct } = body as {
    flagKey?: string;
    description?: string;
    enabled?: boolean;
    targetPlans?: string[];
    targetRoles?: string[];
    rolloutPct?: number;
  };

  if (!flagKey || typeof flagKey !== "string" || !/^[a-z0-9\-_]+$/.test(flagKey)) {
    return NextResponse.json({ error: "invalid-flag-key" }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  const { data: flag, error: upsertErr } = await supabase
    .from("feature_flags")
    .upsert({
      flag_key: flagKey,
      description: description ?? null,
      enabled: enabled ?? false,
      target_plans: targetPlans ?? null,
      target_roles: targetRoles ?? null,
      rollout_pct: rolloutPct ?? null,
      created_by: caller.id,
      updated_by: caller.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "flag_key" })
    .select()
    .single();

  if (upsertErr) return NextResponse.json({ error: "upsert-failed", detail: upsertErr.message }, { status: 500 });

  await logAdminAction(caller.id, "admin.feature_flag_update", flag.id, "feature_flag", { flagKey, enabled });
  return NextResponse.json({ ok: true, flag }, { status: 201 });
}
