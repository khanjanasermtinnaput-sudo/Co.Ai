"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const { user, configured, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  // Already signed in with a real session → go straight to the app. In demo
  // mode the stand-in user must NOT redirect, so the sign-in UI stays
  // reviewable (the button is disabled with a "not configured" notice).
  React.useEffect(() => {
    if (user && configured) router.replace("/");
  }, [user, configured, router]);

  const onGoogle = async () => {
    setSubmitting(true);
    try {
      await signInWithGoogle();
      // The browser is redirected to Google; keep the spinner until it leaves.
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card/60 p-8 shadow-glow backdrop-blur-xl">
        <div className="flex flex-col items-center text-center">
          <Logo size={40} />
          <h1 className="mt-6 text-xl font-semibold tracking-tight">
            Sign in to Co.AI
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Continue with Google to build, save and pick up your projects from
            anywhere.
          </p>
        </div>

        <div className="mt-7">
          <Button
            onClick={onGoogle}
            disabled={!configured || submitting}
            className="h-11 w-full gap-3 bg-white text-[#1f1f1f] hover:bg-white/90"
          >
            <GoogleGlyph />
            {submitting ? "Redirecting…" : "Continue with Google"}
          </Button>

          {!configured && (
            <p className="mt-4 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
              Sign-in isn&apos;t configured yet. Add your Supabase keys to enable
              Google login.
            </p>
          )}
        </div>

        <p className="mt-7 text-center text-xs text-muted-foreground/80">
          By continuing you agree to the Co.AI Terms &amp; Privacy.
        </p>
      </div>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
