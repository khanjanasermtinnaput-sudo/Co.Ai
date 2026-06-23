// ── /api/admin/logs ───────────────────────────────────────────────────────────
// GET  - System logs with filters and pagination.
// POST - Manually create a log entry (OWNER/ADMIN only).

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { requireAdmin } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



export async function GET(req: Request) {
  const { error } = await requireAdmin(req, "ADMIN");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const page       = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
  const limit      = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const severity   = searchParams.get("severity") ?? "";
  const action     = searchParams.get("action") ?? "";
  const actorId    = searchParams.get("actorId") ?? "";
  const targetId   = searchParams.get("targetId") ?? "";
  const targetType = searchParams.get("targetType") ?? "";
  const from       = searchParams.get("from") ?? "";
  const to         = searchParams.get("to") ?? "";

  const supabase = getAdminSupabase();
  let query = supabase
    .from("system_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (severity) query = query.eq("severity", severity);
  if (action)   query = query.ilike("action", `%${action}%`);
  if (actorId)  query = query.eq("actor_id", actorId);
  if (targetId) query = query.eq("target_id", targetId);
  if (targetType) query = query.eq("target_type", targetType);
  if (from) query = query.gte("created_at", from);
  if (to)   query = query.lte("created_at", to);

  const { data: logs, error: dbErr, count } = await query;
  if (dbErr) return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });

  return NextResponse.json({
    logs: logs ?? [],
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

  const { action, targetId, targetType, metadata, severity } = body as {
    action?: string; targetId?: string; targetType?: string;
    metadata?: Record<string, unknown>; severity?: string;
  };

  if (!action) return NextResponse.json({ error: "action-required" }, { status: 400 });

  const { data: log, error: insertErr } = await getAdminSupabase()
    .from("system_logs")
    .insert({
      actor_id: caller.id,
      action,
      target_id: targetId ?? null,
      target_type: targetType ?? null,
      metadata: metadata ?? null,
      severity: severity ?? "info",
    })
    .select().single();

  if (insertErr) return NextResponse.json({ error: "insert-failed", detail: insertErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, log }, { status: 201 });
}
