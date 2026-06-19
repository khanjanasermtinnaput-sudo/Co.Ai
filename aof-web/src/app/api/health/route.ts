// ── /api/health ───────────────────────────────────────────────────────────────
// Full system health check: AI providers, Supabase, Redis, and the tmap-v2
// backend. Powers the Provider Status panel and dependency monitoring.

import { deriveSystemStatus, type ChecklistItem, type SystemHealth } from "@/lib/health";
import { allProviders, isConfigured, pingProvider } from "@/lib/server/ai-providers";
import { logCgntxError, runStartupCheckOnce } from "@/lib/server/ai-log";
import { getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { loadUserKeyOverrides } from "@/lib/server/keys-store";
import { getCorrelationId, correlationHeaders } from "@/lib/server/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Dependency checks ─────────────────────────────────────────────────────────

async function checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const hasRedis = Boolean(
    process.env.REDIS_URL ?? process.env.REDIS_TLS_URL ?? process.env.REDIS_HOST
  );
  if (!hasRedis) return { ok: false, error: "not configured" };

  try {
    const { getRedis } = await import("@/lib/server/redis");
    const start  = performance.now();
    await getRedis().ping();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkTmapBackend(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const backendUrl =
    process.env.COAGENTIX_API_PROXY ?? process.env.CGNTX_API_PROXY ?? process.env.NEXT_PUBLIC_COAGENTIX_API_BASE;
  if (!backendUrl) return { ok: false, error: "not configured" };

  try {
    const start = performance.now();
    const res   = await fetch(`${backendUrl}/v1/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const correlationId = getCorrelationId(req);
  const user      = await getUserFromRequest(req).catch(() => null);
  const overrides = await loadUserKeyOverrides(user?.id);

  const [providers, redisResult, tmapResult] = await Promise.all([
    Promise.all(allProviders().map((p) => pingProvider(p, overrides))),
    checkRedis(),
    checkTmapBackend(),
  ]);

  // Log any provider that came back unhealthy.
  for (const p of providers) {
    if (p.error && p.status === "DISCONNECTED") logCgntxError(p.error);
  }

  const checklist: ChecklistItem[] = [
    ...allProviders().map((p) => ({
      label: `${p.label} API Key`,
      ok:   isConfigured(p, overrides),
      note: isConfigured(p, overrides) ? "Loaded" : "Missing",
    })),
    {
      label: "Database (Supabase)",
      ok:   isAdminConfigured(),
      note: isAdminConfigured() ? "Connected" : "Not configured",
    },
    {
      label: "Cache (Redis)",
      ok:   redisResult.ok,
      note: redisResult.ok
        ? `Connected (${redisResult.latencyMs}ms)`
        : redisResult.error ?? "Unavailable",
    },
    {
      label: "Backend (tmap-v2)",
      ok:   tmapResult.ok,
      note: tmapResult.ok
        ? `Reachable (${tmapResult.latencyMs}ms)`
        : tmapResult.error ?? "Unavailable",
    },
  ];

  const status      = deriveSystemStatus(providers);
  const anyConnected = providers.some((p) => p.status === "CONNECTED");

  runStartupCheckOnce(
    checklist.map((c) => ({ label: `${c.label} ${c.note ?? ""}`.trim(), ok: c.ok })),
    status,
  );

  const health: SystemHealth & {
    dependencies: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
  } = {
    status,
    providers,
    anyConnected,
    checklist,
    checkedAt: new Date().toISOString(),
    dependencies: {
      redis:  redisResult,
      tmap:   tmapResult,
    },
  };

  return Response.json(health, {
    headers: {
      ...correlationHeaders(correlationId),
      "Cache-Control": "no-store",
    },
  });
}
