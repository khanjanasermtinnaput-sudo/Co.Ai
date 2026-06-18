// ── /api/health ───────────────────────────────────────────────────────────────
// Live diagnostics for the AI providers, powering the Provider Status panel. Runs
// a cheap, non-generative auth check against every configured provider and reports
// CONNECTED / DEGRADED / DISCONNECTED / UNKNOWN, plus a startup-style checklist
// and an aggregate system status. No secrets ever leave the server.

import { deriveSystemStatus, type ChecklistItem, type SystemHealth } from "@/lib/health";
import { allProviders, isConfigured, pingProvider } from "@/lib/server/ai-providers";
import { logNexoraError, runStartupCheckOnce } from "@/lib/server/ai-log";
import { getUserFromRequest, isAdminConfigured } from "@/lib/server/supabase-admin";
import { loadUserKeyOverrides } from "@/lib/server/keys-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const user = await getUserFromRequest(req).catch(() => null);
  const overrides = await loadUserKeyOverrides(user?.id);

  const providers = await Promise.all(allProviders().map((p) => pingProvider(p, overrides)));

  // Log any provider that came back unhealthy so the failure is recorded too.
  for (const p of providers) {
    if (p.error && p.status === "DISCONNECTED") logNexoraError(p.error);
  }

  const checklist: ChecklistItem[] = [
    ...allProviders().map((p) => ({
      label: `${p.label} API Key`,
      ok: isConfigured(p, overrides),
      note: isConfigured(p, overrides) ? "Loaded" : "Missing",
    })),
    {
      label: "Database (Supabase)",
      ok: isAdminConfigured(),
      note: isAdminConfigured() ? "Connected" : "Not configured",
    },
  ];

  const status = deriveSystemStatus(providers);
  const anyConnected = providers.some((p) => p.status === "CONNECTED");

  // Emit the startup checklist once per process, matching the Nexora banner format.
  runStartupCheckOnce(
    checklist.map((c) => ({ label: `${c.label} ${c.note ?? ""}`.trim(), ok: c.ok })),
    status,
  );

  const health: SystemHealth = {
    status,
    providers,
    anyConnected,
    checklist,
    checkedAt: new Date().toISOString(),
  };

  return Response.json(health, {
    headers: { "Cache-Control": "no-store" },
  });
}
