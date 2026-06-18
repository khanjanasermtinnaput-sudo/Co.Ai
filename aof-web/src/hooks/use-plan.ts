"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { hasFeature, planFor, type Feature } from "@/lib/plans";

/**
 * React access to the signed-in user's plan + entitlements. Components use this
 * to show/hide plan-gated UI; the hard gate still runs through checkUserAccess /
 * checkFeature in lib/access.ts before the action actually fires.
 */
export function usePlan() {
  const { tier } = useAuth();
  const plan = planFor(tier);
  return {
    tier,
    plan,
    can: (feature: Feature) => hasFeature(tier, feature),
  };
}
