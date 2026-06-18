"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { getSupabase } from "@/lib/supabase/client";

export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login?redirect=/admin");
      return;
    }

    async function checkRole() {
      const supabase = getSupabase();
      if (!supabase) { setChecking(false); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login?redirect=/admin"); return; }

      const res = await fetch("/api/admin/roles", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.status === 403 || res.status === 401) {
        setAdminRole("USER");
        setChecking(false);
        return;
      }

      // If we can call /api/admin/roles successfully, the user is an admin
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // Find the current user's role
        const myRole = (data.roles ?? []).find((r: { user_id: string }) => r.user_id === user!.id)?.role ?? "ADMIN";
        setAdminRole(myRole);
      } else {
        setAdminRole("USER");
      }
      setChecking(false);
    }

    void checkRole();
  }, [user, loading, router]);

  if (loading || checking) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Verifying access…</p>
        </div>
      </div>
    );
  }

  if (!user || adminRole === "USER") {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
            <Shield className="size-6 text-destructive" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground">Access Denied</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You don&apos;t have permission to access the admin panel.
            </p>
          </div>
          <a href="/" className="text-sm text-primary hover:underline">
            Return to app
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
