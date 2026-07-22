"use client";

import { CreditCard, KeyRound } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { planFor, byokBonusLabel } from "@/lib/plans";
import { PricingTable } from "@/components/billing/pricing-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function BillingTab() {
  const { tier } = useAuth();
  const plan = planFor(tier);
  const displayTier = tier === "GUEST" ? "Guest" : plan.name;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-primary" /> Your plan
          </CardTitle>
          <CardDescription>
            You&apos;re on the <span className="font-medium text-foreground">{displayTier}</span> plan.
            Bring your own API key on any plan for a bigger quota (BYOK bonus).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">
            {plan.limits.dailyMessages === Infinity
              ? "Unlimited messages/day"
              : `${plan.limits.dailyMessages} messages/day`}
          </Badge>
          <Badge variant="muted">
            {plan.limits.maxProjects === Infinity
              ? "Unlimited projects"
              : `${plan.limits.maxProjects} projects`}
          </Badge>
          {plan.byokMultiplier > 1 && (
            <Badge variant="default" className="gap-1">
              <KeyRound className="size-3" /> BYOK {byokBonusLabel(tier)} quota
            </Badge>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Plans</h2>
        <PricingTable />
      </div>
    </div>
  );
}
