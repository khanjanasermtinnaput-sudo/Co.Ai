"use client";

import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/hooks/use-plan";
import { evaluateFeature } from "@/lib/access";
import { useAuthStore } from "@/store/auth-store";
import { planFor } from "@/lib/plans";

/**
 * Gates the CoCode workspace itself (not just its Pro/Titan build modes — see
 * checkUserAccess's "premium-model" action) behind the "coagentix-code" plan
 * Feature (Pro+). Mirrors project-workspace.tsx's DeploymentsTab pattern for
 * the "deploy" feature.
 *
 * Uses evaluateFeature() (pure, driven by usePlan()'s reactive tier) rather
 * than access.ts's checkFeature() convenience wrapper — that reads
 * useAuthStore.getState() as a one-off snapshot, which can still be "GUEST"
 * on first render (AuthProvider mirrors the real tier into the store from an
 * effect, after mount) and never updates this component since it isn't a
 * subscribed hook, leaving a signed-in user stuck on a stale "sign in"
 * prompt instead of the correct "upgrade" one.
 */
export function CoCodeGate({ children }: { children: React.ReactNode }) {
  const { tier, can } = usePlan();
  if (can("coagentix-code")) return <>{children}</>;

  const access = evaluateFeature("coagentix-code", { tier });
  const upgradeName = access.upgradeTo ? planFor(access.upgradeTo).name : "Pro";

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-background/60 text-primary">
            <Lock className="size-6" />
          </span>
          <div>
            <p className="font-medium">CoCode is a {upgradeName} feature</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {access.reason ?? `Upgrade to ${upgradeName} to build software with CoCode.`}
            </p>
          </div>
          {access.requiresLogin ? (
            <Button onClick={() => useAuthStore.getState().openLoginModal(access.reason)}>
              Sign in with Google
            </Button>
          ) : (
            <Button asChild>
              <Link href="/settings?tab=billing">See {upgradeName} plan</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
