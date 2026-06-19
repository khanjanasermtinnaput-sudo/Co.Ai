// ── /api/metrics (admin only) ─────────────────────────────────────────────────
// Dashboard metrics aggregated from Supabase and Redis.
// Restricted to OWNER / ADMIN / STAFF roles via admin role check.

import { getUserFromRequest } from "@/lib/server/supabase-admin";
import { getCorrelationId, correlationHeaders } from "@/lib/server/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Role check ────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(["OWNER", "ADMIN", "STAFF"]);

async function isAdmin(userId: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return false;

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();
  return Boolean(data && ADMIN_ROLES.has(data.role as string));
}

// ── Metric helpers ────────────────────────────────────────────────────────────

async function getQueueMetrics() {
  const hasRedis = Boolean(
    process.env.REDIS_URL ?? process.env.REDIS_TLS_URL ?? process.env.REDIS_HOST
  );
  if (!hasRedis) return null;

  try {
    const { getAllQueueStats } = await import("@/lib/server/queue");
    return await getAllQueueStats();
  } catch {
    return null;
  }
}

async function getCostMetrics() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Total cost and token usage from sessions table
    const { data: costRows } = await admin
      .from("sessions")
      .select("total_tokens, total_cost_usd")
      .limit(10000);

    if (!costRows?.length) return { totalTokens: 0, totalCostUsd: 0, sessionCount: 0 };

    const totalTokens  = costRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
    const totalCostUsd = costRows.reduce((s, r) => s + (r.total_cost_usd ?? 0), 0);

    return {
      totalTokens,
      totalCostUsd: Math.round(totalCostUsd * 1e6) / 1e6,
      sessionCount: costRows.length,
    };
  } catch {
    return null;
  }
}

async function getMemoryMetrics() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ count: memoriesCount }, { count: turnsCount }] = await Promise.all([
      admin.from("memories").select("*", { count: "exact", head: true }),
      admin.from("conversation_turns").select("*", { count: "exact", head: true }),
    ]);

    return { memoriesCount: memoriesCount ?? 0, turnsCount: turnsCount ?? 0 };
  } catch {
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const correlationId = getCorrelationId(req);
  const headers       = {
    ...correlationHeaders(correlationId),
    "Cache-Control": "no-store",
  };

  const user = await getUserFromRequest(req).catch(() => null);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }
  if (!(await isAdmin(user.id))) {
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  }

  const [queues, cost, memory] = await Promise.all([
    getQueueMetrics(),
    getCostMetrics(),
    getMemoryMetrics(),
  ]);

  return Response.json(
    {
      collectedAt: new Date().toISOString(),
      queues,
      cost,
      memory,
    },
    { headers }
  );
}
