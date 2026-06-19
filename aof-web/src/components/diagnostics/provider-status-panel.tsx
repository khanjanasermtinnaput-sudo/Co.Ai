"use client";

// ── Provider Status Panel ─────────────────────────────────────────────────────
// Live diagnostics for the AI providers, polled from /api/health. Shows the
// per-provider health (🟢 CONNECTED / 🟡 DEGRADED / 🔴 DISCONNECTED / ⚪ UNKNOWN),
// the aggregate system status and the startup-style checklist. This is how a user
// answers "is it Coagentix, my key, the provider, my quota, or the network?".

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Activity, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchHealth } from "@/lib/api";
import {
  statusDot,
  type ProviderHealth,
  type SystemHealth,
  type SystemStatusLevel,
} from "@/lib/health";
import { formatUtc } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SYSTEM_LABEL: Record<SystemStatusLevel, string> = {
  OPERATIONAL: "Operational",
  DEGRADED: "Degraded",
  DOWN: "All providers down",
  UNKNOWN: "Unknown",
};

const SYSTEM_STYLE: Record<SystemStatusLevel, string> = {
  OPERATIONAL: "border-success/40 bg-success/10 text-success",
  DEGRADED: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  DOWN: "border-destructive/40 bg-destructive/10 text-destructive",
  UNKNOWN: "border-border bg-muted/40 text-muted-foreground",
};

export function ProviderStatusPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHealth(signal);
      setHealth(data);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError((e as Error)?.message ?? "Failed to reach /api/health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-primary" /> AI Providers
            </CardTitle>
            <CardDescription>
              Live health of every AI provider Coagentix can use. Coagentix never hides a failure — if a
              provider is down, you&apos;ll see exactly why here.
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {loading ? "Checking…" : "Refresh"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {health && (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                SYSTEM_STYLE[health.status],
              )}
            >
              System Status: {SYSTEM_LABEL[health.status]}
            </span>
            <span className="text-xs text-muted-foreground">
              Checked {formatUtc(health.checkedAt)}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertOctagon className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Couldn&apos;t reach the health endpoint.</p>
              <p className="text-xs text-destructive/80">{error}</p>
            </div>
          </div>
        )}

        {loading && !health && <p className="text-sm text-muted-foreground">Checking providers…</p>}

        {health && (
          <div className="space-y-2">
            {health.providers.map((p) => (
              <ProviderRow key={p.id} provider={p} />
            ))}
          </div>
        )}

        {health && health.checklist.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Startup check
            </p>
            <ul className="space-y-1.5">
              {health.checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  <span>{c.ok ? "✅" : "❌"}</span>
                  <span className="text-foreground">{c.label}</span>
                  {c.note && <span className="text-xs text-muted-foreground">· {c.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProviderRow({ provider }: { provider: ProviderHealth }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2.5">
      <span className="text-base leading-none" aria-hidden>
        {statusDot(provider.status)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{provider.label}</span>
          {provider.primary && (
            <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
              Primary
            </span>
          )}
        </div>
        {provider.model && <p className="truncate text-xs text-muted-foreground">{provider.model}</p>}
      </div>
      <div className="text-right">
        <p className="text-sm font-medium text-foreground">{provider.status}</p>
        <p className="text-xs text-muted-foreground">{provider.note}</p>
      </div>
    </div>
  );
}
