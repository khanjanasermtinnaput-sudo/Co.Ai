"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { LogoMark } from "@/components/brand/logo";

/**
 * Guards the authenticated app shell. In live mode an unauthenticated visitor is
 * bounced to /login. In demo mode (no Supabase) it renders children untouched so
 * the offline experience keeps working.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { configured, user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (configured && !loading && !user) {
      router.replace("/login");
    }
  }, [configured, loading, user, router]);

  if (!configured) return <>{children}</>;

  if (loading || !user) {
    return (
      <div className="flex h-dvh w-full items-center justify-center">
        <LogoMark size={44} className="animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}
