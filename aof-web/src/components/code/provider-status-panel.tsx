"use client";

// ── AI Provider Status Panel ─────────────────────────────────────────────────
// A diagnostic panel showing every provider's health. Shallow by default (which
// keys are configured); "Deep check" pings each provider for real latency/status.

import { Activity, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AofErrorCode } from "@/lib/provider-errors";
import { cn } from "@/lib/utils";

type ProviderStatus = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNKNOWN";
type SystemStatus = "OPERATIONAL" | "DEGRADED" | "DOWN";

interface ProviderHealth {
  id: string;
  label: string;
  status: ProviderStatus;
  configured: boolean;
  model?: string;
  latencyMs?: number;
  error?: { code: AofErrorCode; status?: number };
}

interface HealthResponse {
  systemStatus: SystemStatus;
  providers: ProviderHealth[];
  deep: boolean;
  checkedAt: string;
}

const DOT: Record<ProviderStatus, string> = {
  CONNECTED: "bg-emerald-400",
  DEGRADED: "bg-amber-400",
  DISCONNECTED: "bg-red-400",
  UNKNOWN: "bg-muted-foreground/50",
};

const STATUS_LABEL: Record<ProviderStatus, string> = {
  CONNECTED: "Connected",
  DEGRADED: "Degraded",
  DISCONNECTED: "Disconnected",
  UNKNOWN: "Unknown",
};

const SYSTEM_BADGE: Record<SystemStatus, string> = {
  OPERATIONAL: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  DEGRADED: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  DOWN: "text-red-300 bg-red-500/10 border-red-500/20",
};

function reason(p: ProviderHealth): string {
  if (!p.configured) return "Missing API key";
  if (p.error) return `${p.error.code}${p.error.status ? ` · HTTP ${p.error.status}` : ""}`;
  if (p.status === "CONNECTED") return p.latencyMs != null ? `${p.latencyMs} ms` : "Configured";
  if (p.status === "DEGRADED") return p.latencyMs != null ? `High latency · ${p.latencyMs} ms` : "Degraded";
  return STATUS_LABEL[p.status];
}

export function ProviderStatusPanel({ className }: { className?: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (deep: boolean) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/providers/health${deep ? "?deep=1" : ""}`, { cache: "no-store" });
      setData((await res.json()) as HealthResponse);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className={cn("rounded-2xl border border-white/[0.07] bg-card/60", className)}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Activity className="size-4 text-primary" />
        <span className="text-sm font-medium">AI Providers</span>
        {data && (
          <span
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              SYSTEM_BADGE[data.systemStatus],
            )}
          >
            {data.systemStatus}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          Deep check
        </button>
      </div>

      <div className="divide-y divide-border/60">
        {error && (
          <p className="px-4 py-3 text-sm text-red-300">Could not reach the health endpoint.</p>
        )}
        {!error && !data && (
          <p className="px-4 py-3 text-sm text-muted-foreground">Checking providers…</p>
        )}
        {data?.providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2.5 px-4 py-2.5">
            <span className={cn("size-2 shrink-0 rounded-full", DOT[p.status])} />
            <span className="text-sm font-medium text-foreground">{p.label}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">{reason(p)}</span>
          </div>
        ))}
      </div>

      {data && (
        <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          {data.deep ? "Deep ping" : "Configuration check"} ·{" "}
          {new Date(data.checkedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
