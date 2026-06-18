"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MessageSquare, FolderKanban, Coins, Globe, KeyRound, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "@/hooks/use-plan";
import { useUsageStore } from "@/store/usage-store";
import { useProjectStore } from "@/store/project-store";
import { effectiveDailyMessages, byokBonusLabel, planFor } from "@/lib/plans";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toLocaleString();
}

function StatBar({
  icon: Icon,
  label,
  used,
  limit,
  unit,
}: {
  icon: typeof MessageSquare;
  label: string;
  used: number;
  limit: number;
  unit?: string;
}) {
  const unlimited = !Number.isFinite(limit);
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const near = !unlimited && pct >= 80;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4 text-primary/80" /> {label}
        </span>
        <span className="font-medium text-foreground">
          {fmt(used)}
          <span className="text-muted-foreground">
            {" "}/ {unlimited ? "∞" : fmt(limit)} {unit}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full transition-all", near ? "bg-amber-500" : "bg-primary")}
          style={{ width: unlimited ? "8%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function UsageDashboard() {
  const { tier, plan } = usePlan();
  const ensureToday = useUsageStore((s) => s.ensureToday);
  const messages = useUsageStore((s) => s.messages);
  const tokens = useUsageStore((s) => s.tokens);
  const searches = useUsageStore((s) => s.searches);
  const projects = useProjectStore((s) => s.projects);

  // Roll the meter over if the day changed since it was last touched.
  useEffect(() => {
    ensureToday();
  }, [ensureToday]);

  const baseDaily = plan.limits.dailyMessages;
  const boostedDaily = effectiveDailyMessages(tier, true);
  const maxProjects = plan.limits.maxProjects;
  const nearMsgLimit =
    Number.isFinite(baseDaily) && messages / Math.max(1, baseDaily) >= 0.8;

  // Suggest the next tier up (PRO is the headline upgrade for most users).
  const suggestTier = tier === "FREE" ? "LITE" : tier === "LITE" ? "PRO" : tier === "PRO" ? "ADVANCED" : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Usage today</CardTitle>
              <CardDescription>Resets daily · {plan.name} plan</CardDescription>
            </div>
            {plan.byokMultiplier > 1 && (
              <Badge variant="default" className="gap-1">
                <KeyRound className="size-3" /> BYOK {byokBonusLabel(tier)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatBar icon={MessageSquare} label="Messages" used={messages} limit={baseDaily} />
          <StatBar
            icon={FolderKanban}
            label="Projects"
            used={projects.length}
            limit={maxProjects}
          />
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Stat icon={Coins} label="Tokens (est.)" value={fmt(tokens)} />
            <Stat icon={Globe} label="Searches" value={fmt(searches)} />
          </div>

          {Number.isFinite(baseDaily) && plan.byokMultiplier > 1 && (
            <p className="flex items-center gap-1.5 rounded-lg border border-primary/15 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground">
              <KeyRound className="size-3.5 text-primary/80" />
              Use your own API key to raise today&apos;s limit to{" "}
              <span className="font-medium text-foreground">{fmt(boostedDaily)}</span> messages
              ({byokBonusLabel(tier)}).
            </p>
          )}
        </CardContent>
      </Card>

      {suggestTier && nearMsgLimit && (
        <Card className="border-primary/30">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-medium">You&apos;re close to today&apos;s limit</p>
              <p className="text-xs text-muted-foreground">
                Upgrade to {planFor(suggestTier).name} for higher quotas and more features.
              </p>
            </div>
            <Link
              href="/settings?tab=billing"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Upgrade <ArrowUpRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Plan benefits</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
            {plan.highlights.map((h) => (
              <li key={h} className="flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-primary/60" /> {h}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Coins; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 text-primary/70" /> {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
