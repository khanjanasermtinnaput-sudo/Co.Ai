import React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  accent?: string;
  className?: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, trend, accent = "text-primary", className }: StatCardProps) {
  return (
    <div className={cn(
      "rounded-xl border border-border/50 bg-card/50 p-5 backdrop-blur-sm",
      className
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
          <p className={cn("mt-1.5 text-2xl font-bold tabular-nums", accent)}>{value}</p>
          {subtitle && <p className="mt-1 text-[12px] text-muted-foreground">{subtitle}</p>}
          {trend && (
            <div className={cn(
              "mt-2 flex items-center gap-1 text-[11px] font-medium",
              trend.value >= 0 ? "text-emerald-500" : "text-red-500"
            )}>
              <span>{trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}%</span>
              <span className="text-muted-foreground font-normal">{trend.label}</span>
            </div>
          )}
        </div>
        <div className={cn("rounded-xl p-2.5", "bg-primary/10")}>
          <Icon className={cn("size-5", accent)} />
        </div>
      </div>
    </div>
  );
}
