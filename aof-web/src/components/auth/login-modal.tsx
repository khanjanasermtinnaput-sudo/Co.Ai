"use client";

import * as React from "react";
import { Check, Sparkles } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useAuthStore } from "@/store/auth-store";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const BENEFITS = [
  "Save your chat history",
  "Save and manage projects",
  "Use Coagentix Code to build software",
  "Access more AI models",
  "Sync across all your devices",
];

/**
 * Global login wall. Opened from anywhere via useAuthStore.openLoginModal() —
 * notably when a guest reaches the 3-message limit. Mounted once at the app root
 * so it overlays the current view without a route change (streaming/state are
 * preserved). Google is the only sign-in method.
 */
export function LoginModal() {
  const { configured, signInWithGoogle } = useAuth();
  const open = useAuthStore((s) => s.loginModalOpen);
  const reason = useAuthStore((s) => s.loginModalReason);
  const closeLoginModal = useAuthStore((s) => s.closeLoginModal);
  const [submitting, setSubmitting] = React.useState(false);

  const onGoogle = async () => {
    setSubmitting(true);
    try {
      await signInWithGoogle();
      // Browser redirects to Google; keep the spinner until it leaves.
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeLoginModal()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center text-center">
          <Logo size={36} />
          <DialogTitle className="mt-4 text-xl">
            Continue with Google
          </DialogTitle>
          <DialogDescription className="mt-1">
            {reason ?? "Sign in to keep chatting and unlock everything Coagentix can do."}
          </DialogDescription>
        </DialogHeader>

        <ul className="my-2 space-y-2.5">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-center gap-2.5 text-sm text-foreground">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Check className="size-3 text-primary" />
              </span>
              {b}
            </li>
          ))}
        </ul>

        <Button
          onClick={onGoogle}
          disabled={!configured || submitting}
          className="h-11 w-full gap-3 bg-white text-[#1f1f1f] hover:bg-white/90"
        >
          <GoogleGlyph />
          {submitting ? "Redirecting…" : "Continue with Google"}
        </Button>

        {!configured ? (
          <p className="rounded-lg border border-border bg-background/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
            Sign-in isn&apos;t configured yet. Add your Supabase keys to enable
            Google login.
          </p>
        ) : (
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground/80">
            <Sparkles className="size-3 text-primary/70" />
            Free to start — no credit card required.
          </p>
        )}
      </DialogContent>
    </Dialog>
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
