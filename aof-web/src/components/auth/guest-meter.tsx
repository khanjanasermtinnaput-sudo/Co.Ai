"use client";

import { Sparkles } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import { useGuestStore, GUEST_LIMIT } from "@/store/guest-store";

/**
 * Subtle "you're a guest" hint shown above the composer. Tells visitors how many
 * free messages remain and offers a one-tap sign-in. Renders nothing for signed-in
 * users. SPA — the button opens the login modal, never navigates.
 */
export function GuestMeter() {
  const tier = useAuthStore((s) => s.tier);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);
  const count = useGuestStore((s) => s.messageCount);

  if (tier !== "GUEST") return null;

  const remaining = Math.max(0, GUEST_LIMIT - count);
  const atLimit = remaining === 0;

  return (
    <div className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-center gap-2 text-xs text-muted-foreground">
      <Sparkles className="size-3 text-primary/70" />
      <span>
        {atLimit
          ? "Free messages used up."
          : `${remaining} free message${remaining === 1 ? "" : "s"} left`}
      </span>
      <button
        type="button"
        onClick={() =>
          openLoginModal(
            atLimit
              ? "Sign in with Google to keep chatting."
              : "Sign in with Google to chat without limits.",
          )
        }
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Sign in
      </button>
    </div>
  );
}
