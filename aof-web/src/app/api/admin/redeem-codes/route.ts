// ── /api/admin/redeem-codes ───────────────────────────────────────────────────
// GET  - List all redeem codes with usage stats.
// POST - Create a new redeem code.
// Accessible by OWNER and ADMIN only.

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";
import { logAdminAction } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function GET(req: Request) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const search = searchParams.get("search")?.trim() ?? "";
  const activeOnly = searchParams.get("active") !== "false";

  const supabase = getAdminSupabase();

  let query = supabase
    .from("redeem_codes")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (search) query = query.ilike("code", `%${search}%`);
  if (activeOnly) query = query.is("disabled_at", null);

  const { data: codes, error: dbErr, count } = await query;
  if (dbErr) return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });

  return NextResponse.json({
    codes: codes ?? [],
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
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const { code, plan, description, durationDays, maxUses, singleUsePerUser, expiresAt } = body as {
    code?: string;
    plan?: string;
    description?: string;
    durationDays?: number;
    maxUses?: number;
    singleUsePerUser?: boolean;
    expiresAt?: string;
  };

  if (!code || typeof code !== "string" || !/^[A-Z0-9\-_]{3,64}$/i.test(code)) {
    return NextResponse.json({ error: "invalid-code-format" }, { status: 400 });
  }

  const VALID_PLANS = ["FREE", "LITE", "PRO", "ADVANCED"];
  if (!plan || !VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: "invalid-plan" }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  const { data: existing } = await supabase.from("redeem_codes").select("id").eq("code", code.toUpperCase()).maybeSingle();
  if (existing) return NextResponse.json({ error: "code-already-exists" }, { status: 409 });

  const { data: newCode, error: insertErr } = await supabase
    .from("redeem_codes")
    .insert({
      code: code.toUpperCase(),
      plan,
      description: description ?? null,
      duration_days: durationDays ?? null,
      max_uses: maxUses ?? null,
      single_use_per_user: singleUsePerUser !== false,
      created_by: caller.id,
      expires_at: expiresAt ?? null,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: "insert-failed", detail: insertErr.message }, { status: 500 });

  await logAdminAction(caller.id, "redeem_code.create", newCode.id, "redeem_code", {
    code: newCode.code, plan, durationDays, maxUses,
  });

  return NextResponse.json({ ok: true, code: newCode }, { status: 201 });
}
