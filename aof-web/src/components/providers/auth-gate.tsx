"use client";

import * as React from "react";
import { useAuth } from "./auth-provider";
import { LogoMark } from "@/components/brand/logo";

/**
 * Gates the authenticated app shell. Guests are welcome — they can browse and
 * chat (up to the guest message limit) without signing in, so we no longer bounce
 * unauthenticated visitors to /login. We only hold rendering briefly while the
 * initial Supabase session check resolves, to avoid a flash of signed-out UI for
 * users who actually have a session.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { configured, loading } = useAuth();

  // Demo mode (no Supabase) renders immediately.
  if (!configured) return <>{children}</>;

  // Live mode: wait for the first session resolution, then render for everyone
  // (signed-in users and guests alike). Access to privileged actions is enforced
  // at the action level via checkUserAccess(), not by blocking the whole app.
  if (loading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center">
        <LogoMark size={44} className="animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}
