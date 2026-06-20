"use client";

import React, { useEffect, useState } from "react";
import { Cpu, RefreshCw, AlertCircle, CheckCircle, Zap, DollarSign } from "lucide-react";
import { adminApi } from "@/components/admin/admin-client";
import { StatCard } from "@/components/admin/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PERIODS = [{ label: "7 Days", value: "7d" }, { label: "30 Days", value: "30d" }, { label: "90 Days", value: "90d" }];

const PROVIDER_COLORS: Record<string, string> = {
  gemini: "text-blue-400", deepseek: "text-cyan-400",
  qwen: "text-violet-400", llama: "text-emerald-400",
  openrouter: "text-orange-400", anthropic: "text-amber-400",
};

export default function ApiMonitoringPage() {
  const [period, setPeriod] = useState("7d");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerFilter, setProviderFilter] = useState("");

  async function load(p = period, prov = providerFilter) {
    setLoading(true);
    try {
      const res = await adminApi.apiUsage.get(p, prov || undefined);
      setData(res);
    } catch {}
    finally { setLoading(false); }
  }

  // load() is intentionally re-run only when the period or provider filter changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(period, providerFilter); }, [period, providerFilter]);

  const totals = data?.totals as { requests: number; successful: number; errors: number; totalTokens: number; totalCost: number; avgLatency: number } | null;
  const byProvider = data?.byProvider as Record<string, { requests: number; errors: number; tokens: number; cost: number; avgLatency: number }> | null;
  const dailyChart = (data?.dailyChart as Array<{ date: string; requests: number; errors: number; tokens: number }>) ?? [];
  const errorCodes = data?.errorCodes as Record<string, number> | null;
  const maxRequests = Math.max(...dailyChart.map((d) => d.requests), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">API Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-0.5">AI provider usage and errors</p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
              className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                period === p.value ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30"
              )}>{p.label}</button>
          ))}
          <Button variant="outline" size="sm" onClick={() => load(period)} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Total Requests" value={loading ? "—" : (totals?.requests ?? 0).toLocaleString()} icon={Cpu} accent="text-blue-400" />
        <StatCard title="Success Rate"
          value={loading ? "—" : totals ? `${totals.requests > 0 ? Math.round((totals.successful / totals.requests) * 100) : 100}%` : "—"}
          icon={CheckCircle} accent="text-emerald-400" />
        <StatCard title="Errors" value={loading ? "—" : (totals?.errors ?? 0).toLocaleString()} icon={AlertCircle} accent="text-red-400" />
        <StatCard title="Avg Latency" value={loading ? "—" : `${totals?.avgLatency ?? 0}ms`} icon={Zap} accent="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Per-provider breakdown */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-4">Provider Breakdown</h2>
          {loading ? (
            <div className="space-y-3">{Array.from({length:5}).map((_,i)=><div key={i} className="h-12 rounded-lg bg-muted/20 animate-pulse"/>)}</div>
          ) : byProvider && Object.keys(byProvider).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(byProvider)
                .sort((a, b) => b[1].requests - a[1].requests)
                .map(([provider, stats]) => (
                  <div key={provider} className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
                    <div className={cn("size-2 rounded-full bg-current", PROVIDER_COLORS[provider] ?? "text-muted-foreground")} />
                    <p className={cn("text-sm font-medium capitalize w-24 shrink-0", PROVIDER_COLORS[provider] ?? "text-foreground")}>{provider}</p>
                    <div className="flex-1 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                      <span>{stats.requests.toLocaleString()} req</span>
                      <span>{stats.tokens.toLocaleString()} tok</span>
                      <span className={stats.errors > 0 ? "text-red-400" : ""}>{stats.errors} err</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">${stats.cost.toFixed(4)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No API usage data for this period</p>
          )}
        </div>

        {/* Daily requests chart */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-4">Daily Requests</h2>
          {loading ? (
            <div className="h-36 rounded-lg bg-muted/20 animate-pulse" />
          ) : dailyChart.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data</p>
          ) : (
            <>
              <div className="flex h-36 items-end gap-1">
                {dailyChart.map(({ date, requests, errors }) => (
                  <div key={date} className="group relative flex flex-1 flex-col items-center">
                    <div className="w-full flex flex-col-reverse" style={{ height: `${Math.max((requests / maxRequests) * 100, requests > 0 ? 3 : 0.5)}%` }}>
                      <div className="w-full rounded-t bg-primary/40 hover:bg-primary/60 transition-colors h-full" />
                      {errors > 0 && <div className="w-full bg-red-500/50 rounded-t" style={{ height: `${Math.round((errors / Math.max(requests, 1)) * 100)}%` }} />}
                    </div>
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover border border-border px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {date.slice(5)}: {requests} req, {errors} err
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>{dailyChart[0]?.date?.slice(5)}</span>
                <span>{dailyChart[dailyChart.length - 1]?.date?.slice(5)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Error codes */}
      {!loading && errorCodes && Object.keys(errorCodes).length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <AlertCircle className="size-4 text-red-400" />
            Top Error Codes
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(errorCodes).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([code, count]) => (
              <div key={code} className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                <p className="text-xs font-mono text-red-400 truncate">{code}</p>
                <p className="text-sm font-bold mt-0.5">{count} times</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
