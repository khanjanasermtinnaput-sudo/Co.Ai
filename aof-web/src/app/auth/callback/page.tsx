"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { LogoMark } from "@/components/brand/logo";
import { sanitizeRedirectPath } from "@/lib/utils";

/**
 * OAuth landing page. Google redirects here with a `?code=` (PKCE). We exchange
 * it for a session exactly once, then route into the app. Errors fall back to
 * /login instead of looping.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.replace("/");
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    // Round-tripped from /login?redirect=... via signInWithGoogle's redirectTo,
    // so a sign-in started from /admin lands back on /admin, not the chat home.
    const target = sanitizeRedirectPath(params.get("redirect"));
    const loginPath = target === "/" ? "/login" : `/login?redirect=${encodeURIComponent(target)}`;
    const goLogin = (msg: string) => {
      if (cancelled) return;
      setError(msg);
      setTimeout(() => router.replace(loginPath), 1600);
    };

    (async () => {
      const oauthError = params.get("error_description") || params.get("error");
      if (oauthError) {
        goLogin(oauthError);
        return;
      }

      const code = params.get("code");
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) {
          // The code may already have been consumed — if a session exists, proceed.
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            if (!cancelled) router.replace(target);
            return;
          }
          goLogin(exErr.message);
          return;
        }
        if (!cancelled) router.replace(target);
        return;
      }

      // No code present — maybe the user is already signed in.
      const { data } = await supabase.auth.getSession();
      if (!cancelled) router.replace(data.session ? target : loginPath);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark size={44} className={error ? undefined : "animate-pulse"} />
      <p className="text-sm text-muted-foreground">
        {error ? `Sign-in failed: ${error}` : "Signing you in…"}
      </p>
    </main>
  );
}
