// ── /api/admin/api-usage ─────────────────────────────────────────────────────
// GET - Aggregated API provider usage metrics for the admin dashboard.
// Query: ?period=7d|30d|90d&provider=gemini

import { NextResponse } from "next/server";
import { getAdminSupabase, getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";

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
  const period = searchParams.get("period") ?? "7d";
  const providerFilter = searchParams.get("provider") ?? "";
  const days = period === "90d" ? 90 : period === "30d" ? 30 : 7;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = getAdminSupabase();

  let query = supabase
    .from("api_usage_metrics")
    .select("provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, success, error_code, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (providerFilter) query = query.eq("provider", providerFilter);

  const { data: metrics, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "query-failed", detail: dbErr.message }, { status: 500 });

  const rows = metrics ?? [];

  // Aggregate totals
  const totals = {
    requests: rows.length,
    successful: rows.filter((r) => r.success).length,
    errors: rows.filter((r) => !r.success).length,
    totalTokens: rows.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
    totalCost: rows.reduce((s, r) => s + (Number(r.cost_usd) ?? 0), 0),
    avgLatency: rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / rows.filter((r) => r.latency_ms).length || 0)
      : 0,
  };

  // Per-provider breakdown
  const byProvider: Record<string, {
    requests: number; errors: number; tokens: number; cost: number; avgLatency: number;
  }> = {};
  for (const r of rows) {
    if (!byProvider[r.provider]) {
      byProvider[r.provider] = { requests: 0, errors: 0, tokens: 0, cost: 0, avgLatency: 0 };
    }
    byProvider[r.provider].requests++;
    if (!r.success) byProvider[r.provider].errors++;
    byProvider[r.provider].tokens += r.total_tokens ?? 0;
    byProvider[r.provider].cost += Number(r.cost_usd) ?? 0;
    byProvider[r.provider].avgLatency += r.latency_ms ?? 0;
  }
  // Average the latency
  for (const p of Object.keys(byProvider)) {
    byProvider[p].avgLatency = byProvider[p].requests > 0
      ? Math.round(byProvider[p].avgLatency / byProvider[p].requests) : 0;
    byProvider[p].cost = Math.round(byProvider[p].cost * 1_000_000) / 1_000_000;
  }

  // Daily breakdown for chart (last 14 days capped)
  const chartDays = Math.min(days, 14);
  const dailyChart: Array<{ date: string; requests: number; errors: number; tokens: number }> = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const dayStart = new Date(Date.now() - i * 86_400_000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const dayRows = rows.filter((r) => {
      const t = new Date(r.created_at);
      return t >= dayStart && t < dayEnd;
    });
    dailyChart.push({
      date: dayStart.toISOString().split("T")[0],
      requests: dayRows.length,
      errors: dayRows.filter((r) => !r.success).length,
      tokens: dayRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
    });
  }

  // Top error codes
  const errorCodes: Record<string, number> = {};
  for (const r of rows.filter((r) => !r.success && r.error_code)) {
    errorCodes[r.error_code!] = (errorCodes[r.error_code!] ?? 0) + 1;
  }

  return NextResponse.json({ period, totals, byProvider, dailyChart, errorCodes });
}
