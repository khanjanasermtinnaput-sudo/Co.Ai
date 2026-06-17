"use client";

import React, { useEffect, useState } from "react";
import {
  Users, CreditCard, Ticket, Flag, Bell, TrendingUp,
  AlertTriangle, Activity, RefreshCw,
} from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { adminApi } from "@/components/admin/admin-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AnalyticsData {
  totalUsers: number;
  newUsers: number;
  activeUsers: number;
  activeUsers7d: number;
  activeSubs: number;
  newSubs: number;
  activeCodes: number;
  codeUsesInPeriod: number;
  enabledFlags: number;
  activeAnnouncements: number;
  tierDistribution: Array<{ tier: string; count: number; pct: number }>;
  roleCounts: Record<string, number>;
  dailyNewUsers: Array<{ date: string; count: number }>;
}

const TIER_COLORS: Record<string, string> = {
  FREE: "text-muted-foreground",
  LITE: "text-blue-400",
  PRO: "text-violet-400",
  ADVANCED: "text-amber-400",
};

const TIER_BG: Record<string, string> = {
  FREE: "bg-muted/40",
  LITE: "bg-blue-500/10",
  PRO: "bg-violet-500/10",
  ADVANCED: "bg-amber-500/10",
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.analytics.get("30d");
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const maxDailyUsers = data ? Math.max(...data.dailyNewUsers.map((d) => d.count), 1) : 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Platform overview — last 30 days</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={loading ? "—" : (data?.totalUsers ?? 0).toLocaleString()}
          subtitle={loading ? undefined : `+${data?.newUsers ?? 0} new this period`}
          icon={Users}
          accent="text-blue-400"
        />
        <StatCard
          title="Active Users"
          value={loading ? "—" : (data?.activeUsers7d ?? 0).toLocaleString()}
          subtitle="Last 7 days"
          icon={Activity}
          accent="text-emerald-400"
        />
        <StatCard
          title="Active Subscriptions"
          value={loading ? "—" : (data?.activeSubs ?? 0).toLocaleString()}
          subtitle={loading ? undefined : `+${data?.newSubs ?? 0} granted this period`}
          icon={CreditCard}
          accent="text-violet-400"
        />
        <StatCard
          title="Redeem Codes"
          value={loading ? "—" : (data?.activeCodes ?? 0).toLocaleString()}
          subtitle={loading ? undefined : `${data?.codeUsesInPeriod ?? 0} uses this period`}
          icon={Ticket}
          accent="text-amber-400"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Feature Flags"
          value={loading ? "—" : (data?.enabledFlags ?? 0).toLocaleString()}
          subtitle="Enabled"
          icon={Flag}
          accent="text-pink-400"
        />
        <StatCard
          title="Announcements"
          value={loading ? "—" : (data?.activeAnnouncements ?? 0).toLocaleString()}
          subtitle="Active"
          icon={Bell}
          accent="text-sky-400"
        />
        <StatCard
          title="Monthly Growth"
          value={loading ? "—" : data ? `${data.newUsers}` : "0"}
          subtitle="New users this period"
          icon={TrendingUp}
          accent="text-teal-400"
        />
        <StatCard
          title="Admin Users"
          value={loading ? "—" : data ? Object.values(data.roleCounts).reduce((a, b) => a + b, 0) : 0}
          subtitle="With elevated roles"
          icon={Users}
          accent="text-orange-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tier distribution */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-4">Plan Distribution</h2>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map((i) => (
                <div key={i} className="h-8 rounded-lg bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {(data?.tierDistribution ?? []).map(({ tier, count, pct }) => (
                <div key={tier} className="flex items-center gap-3">
                  <div className="w-16 shrink-0">
                    <Badge variant="outline" className={cn("text-[10px]", TIER_COLORS[tier])}>
                      {tier}
                    </Badge>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", TIER_BG[tier])}
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: "currentColor", opacity: 0.6 }}
                      />
                    </div>
                  </div>
                  <div className="w-20 shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">
                    {count.toLocaleString()} ({pct}%)
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Daily new users chart */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-4">New Users — Last 14 Days</h2>
          {loading ? (
            <div className="h-32 rounded-lg bg-muted/20 animate-pulse" />
          ) : (
            <div className="flex h-32 items-end gap-1">
              {(data?.dailyNewUsers ?? []).map(({ date, count }) => (
                <div key={date} className="group relative flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-sm bg-primary/40 hover:bg-primary/60 transition-colors"
                    style={{ height: `${Math.round((count / maxDailyUsers) * 100)}%`, minHeight: count > 0 ? "4px" : "1px" }}
                  />
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-popover px-1 py-0.5 text-[10px] text-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 border border-border">
                    {date.slice(5)} · {count}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>{data?.dailyNewUsers?.[0]?.date?.slice(5) ?? ""}</span>
            <span>{data?.dailyNewUsers?.[data.dailyNewUsers.length - 1]?.date?.slice(5) ?? ""}</span>
          </div>
        </div>
      </div>

      {/* Role distribution */}
      {!loading && data && Object.keys(data.roleCounts).length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <h2 className="font-semibold text-sm mb-4">Admin Role Distribution</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(data.roleCounts).map(([role, count]) => (
              <div key={role} className="rounded-lg border border-border/50 bg-background/50 px-4 py-2.5">
                <p className="text-lg font-bold">{count}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{role}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
