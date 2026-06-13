"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { LogoMark } from "@/components/brand/logo";

/**
 * OAuth landing page. The Supabase client (detectSessionInUrl) exchanges the
 * `?code=` for a session automatically; we just wait for it and route home.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  React.useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.replace("/");
      return;
    }

    let done = false;
    const finish = (path: string) => {
      if (done) return;
      done = true;
      router.replace(path);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish("/");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish("/");
    });

    // Safety net: if nothing resolves, send the user back to sign in.
    const timeout = setTimeout(() => finish("/login"), 8000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <LogoMark size={44} className="animate-pulse" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </main>
  );
}
