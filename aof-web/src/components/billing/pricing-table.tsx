"use client";

import { Check, Sparkles, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  PLANS,
  PRICING_TIERS,
  formatTHB,
  byokBonusLabel,
} from "@/lib/plans";
import type { UserTier } from "@/store/auth-store";
import { TIER_RANK } from "@/store/auth-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const RECOMMENDED: UserTier = "PRO";

export function PricingTable() {
  const { tier: currentTier, configured } = useAuth();
  // Guests see FREE as their reference point for "current".
  const current = currentTier === "GUEST" ? "FREE" : currentTier;

  const onChoose = (tier: UserTier) => {
    if (!configured) {
      toast("Sign-in isn't configured", { description: "Add Supabase keys to enable accounts & billing." });
      return;
    }
    // Checkout is not wired yet — a payment provider (Stripe/Omise) is required.
    toast(`${PLANS[tier].name} — checkout coming soon`, {
      description: "การชำระเงินกำลังจะเปิดให้บริการเร็ว ๆ นี้",
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2">
      {PRICING_TIERS.map((tier) => {
        const plan = PLANS[tier];
        const isCurrent = tier === current;
        const isRecommended = tier === RECOMMENDED;
        const isDowngrade = TIER_RANK[tier] < TIER_RANK[current];

        return (
          <div
            key={tier}
            className={cn(
              "relative flex flex-col rounded-2xl border bg-card/50 p-5",
              isRecommended ? "border-primary/40 shadow-glow" : "border-border",
              isCurrent && "ring-1 ring-primary/40",
            )}
          >
            {isRecommended && !isCurrent && (
              <Badge variant="default" className="absolute -top-2.5 left-5 w-fit gap-1">
                <Sparkles className="size-3" /> Recommended
              </Badge>
            )}
            {isCurrent && (
              <Badge variant="muted" className="absolute -top-2.5 left-5 w-fit">
                Current plan
              </Badge>
            )}

            <h3 className="text-base font-semibold">{plan.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{plan.tagline}</p>

            <div className="mt-3 flex items-end gap-1">
              <span className="text-2xl font-semibold">{formatTHB(plan.priceTHB)}</span>
              {plan.priceTHB > 0 && (
                <span className="pb-0.5 text-xs text-muted-foreground">/ เดือน</span>
              )}
            </div>

            {plan.byokMultiplier > 1 && (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-primary/90">
                <KeyRound className="size-3" />
                BYOK bonus {byokBonusLabel(tier)} quota
              </p>
            )}

            <ul className="mt-4 flex-1 space-y-1.5 text-xs text-muted-foreground">
              {plan.highlights.map((h) => (
                <li key={h} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>

            <Button
              variant={isRecommended && !isCurrent ? "default" : "secondary"}
              className="mt-5 w-full"
              disabled={isCurrent || isDowngrade}
              onClick={() => onChoose(tier)}
            >
              {isCurrent
                ? "Your plan"
                : isDowngrade
                  ? "Included"
                  : plan.priceTHB === 0
                    ? "Get started"
                    : `Upgrade to ${plan.name}`}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
