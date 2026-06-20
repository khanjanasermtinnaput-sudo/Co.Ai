"use client";

import React, { useEffect, useState } from "react";
import { BarChart3, Users, TrendingUp, Activity, CreditCard, RefreshCw } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { adminApi } from "@/components/admin/admin-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PERIODS = [
  { label: "7 Days",  value: "7d" },
  { label: "30 Days", value: "30d" },
  { label: "90 Days", value: "90d" },
];

const TIER_COLORS: Record<string, string> = {
  FREE: "bg-muted/50 text-muted-foreground", LITE: "bg-blue-500/10 text-blue-400",
  PRO: "bg-violet-500/10 text-violet-400", ADVANCED: "bg-amber-500/10 text-amber-400",
};

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(p = period) {
    setLoading(true);
    try {
      const res = await adminApi.analytics.get(p);
      setData(res);
    } catch {}
    finally { setLoading(false); }
  }

  // load() is intentionally re-run only when the period changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(period); }, [period]);

  const tierDist = (data?.tierDistribution as Array<{ tier: string; count: number; pct: number }>) ?? [];
  const dailyUsers = (data?.dailyNewUsers as Array<{ date: string; count: number }>) ?? [];
  const maxDaily = Math.max(...dailyUsers.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Platform metrics and growth</p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button key={p.value} type="button"
              onClick={() => setPeriod(p.value)}
              className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                period === p.value ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30"
              )}>{p.label}</button>
          ))}
          <Button variant="outline" size="sm" onClick={() => load(period)} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Total Users" value={loading ? "—" : ((data?.totalUsers as number) ?? 0).toLocaleString()} icon={Users} accent="text-blue-400" />
        <StatCard title="New Users" value={loading ? "—" : ((data?.newUsers as number) ?? 0).toLocaleString()} subtitle={`Last ${period}`} icon={TrendingUp} accent="text-emerald-400" />
        <StatCard title="Active Users" value={loading ? "—" : ((data?.activeUsers as number) ?? 0).toLocaleString()} subtitle={`Active in last ${period}`} icon={Activity} accent="text-violet-400" />
        <StatCard title="Subscriptions" value={loading ? "—" : ((data?.activeSubs as number) ?? 0).toLocaleString()} subtitle={`${(data?.newSubs as number) ?? 0} new`} icon={CreditCard} accent="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Plan distribution */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-1">Plan Distribution</h2>
          <p className="text-[12px] text-muted-foreground mb-4">Users per subscription tier</p>
          {loading ? (
            <div className="space-y-3">{Array.from({length:4}).map((_,i)=><div key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse"/>)}</div>
          ) : (
            <div className="space-y-3">
              {tierDist.map(({ tier, count, pct }) => (
                <div key={tier} className="flex items-center gap-3">
                  <div className="w-20 shrink-0">
                    <Badge variant="outline" className={cn("text-[10px]", TIER_COLORS[tier])}>{tier}</Badge>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
                        <div className="h-full rounded-full bg-primary/40" style={{ width: `${Math.max(pct, 1)}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground w-10 text-right">{pct}%</span>
                    </div>
                  </div>
                  <span className="text-[12px] text-foreground tabular-nums w-16 text-right">{count.toLocaleString()} users</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Daily new users */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-1">New Users</h2>
          <p className="text-[12px] text-muted-foreground mb-4">Daily signups — last 14 days</p>
          {loading ? (
            <div className="h-36 rounded-lg bg-muted/20 animate-pulse" />
          ) : (
            <>
              <div className="flex h-36 items-end gap-1">
                {dailyUsers.map(({ date, count }) => (
                  <div key={date} className="group relative flex flex-1 flex-col items-center">
                    <div
                      className="w-full rounded-t bg-primary/40 hover:bg-primary/70 transition-colors"
                      style={{ height: `${Math.max((count / maxDaily) * 100, count > 0 ? 3 : 0.5)}%` }}
                    />
                    <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover border border-border px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {date.slice(5)}: {count}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>{dailyUsers[0]?.date?.slice(5)}</span>
                <span>{dailyUsers[dailyUsers.length - 1]?.date?.slice(5)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Revenue model */}
      <div className="rounded-xl border border-border/50 bg-card/50 p-5">
        <h2 className="font-semibold text-sm mb-4">Revenue Model (Estimated)</h2>
        {loading ? (
          <div className="h-20 rounded-lg bg-muted/20 animate-pulse" />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {tierDist.map(({ tier, count }) => {
              const prices: Record<string,number> = { FREE: 0, LITE: 49, PRO: 149, ADVANCED: 399 };
              const mrr = count * (prices[tier] ?? 0);
              return (
                <div key={tier} className="rounded-lg border border-border/50 bg-background/50 p-3">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{tier}</p>
                  <p className="text-lg font-bold mt-1">
                    {mrr === 0 ? "—" : `฿${mrr.toLocaleString()}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{count} users · ฿{prices[tier] ?? 0}/mo</p>
                </div>
              );
            })}
          </div>
        )}
        {!loading && data && (
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-[12px] text-muted-foreground">Estimated Monthly Revenue</p>
            <p className="text-xl font-bold text-primary mt-0.5">
              ฿{tierDist.reduce((sum, { tier, count }) => {
                const prices: Record<string,number> = { FREE: 0, LITE: 49, PRO: 149, ADVANCED: 399 };
                return sum + count * (prices[tier] ?? 0);
              }, 0).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
