"use client";

import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuthStore, type UserTier } from "@/store/auth-store";
import { useGuestStore } from "@/store/guest-store";
import { useChatStore } from "@/store/chat-store";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  tier: UserTier;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** True when Supabase is configured (live auth). False = offline demo mode. */
  configured: boolean;
  /** Effective access tier (GUEST when signed out). */
  tier: UserTier;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Stand-in identity used when no backend is configured, so the UI still works. */
const DEMO_USER: AuthUser = {
  id: "demo",
  email: "you@coagentix.ai",
  name: "Co.AI User",
  tier: "FREE",
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

/**
 * Resolve a signed-in user's access tier. There is no billing/subscription table
 * yet, so every authenticated account is FREE; LITE/PRO can later be read from a
 * `profiles.tier` column or app_metadata without touching call sites.
 */
function tierForSession(session: Session): UserTier {
  const meta = (session.user.app_metadata ?? {}) as Record<string, unknown>;
  const raw = String(meta.tier ?? "").toUpperCase();
  if (raw === "ADVANCED" || raw === "PRO" || raw === "LITE" || raw === "FREE") return raw;
  return "FREE";
}

/** Normalise a Supabase session into the shape the UI consumes. */
function toAuthUser(session: Session | null): AuthUser | null {
  const u = session?.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, string | undefined>;
  const email = u.email ?? meta.email ?? "";
  const name =
    meta.full_name || meta.name || (email ? email.split("@")[0] : "Co.AI User");
  return {
    id: u.id,
    email,
    name,
    avatarUrl: meta.avatar_url || meta.picture || undefined,
    tier: tierForSession(session),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const [user, setUser] = React.useState<AuthUser | null>(
    configured ? null : DEMO_USER,
  );
  const [loading, setLoading] = React.useState(configured);
  // Track the previous signed-in id so we can detect a fresh login (null → id)
  // and migrate any guest chat that was started before signing in.
  const prevUserId = React.useRef<string | null>(user?.id ?? null);

  React.useEffect(() => {
    if (!configured) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(toAuthUser(data.session));
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(toAuthUser(session));
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  // Mirror auth state into the non-React store + handle the guest→user handoff.
  React.useEffect(() => {
    const tier: UserTier = user ? user.tier : "GUEST";
    // A demo user has a synthetic id ("demo") and is not a real Supabase account.
    const realUserId = user && user.id !== "demo" ? user.id : null;
    useAuthStore.getState().setAuth({ userId: realUserId, tier, ready: !loading });

    const prev = prevUserId.current;
    if (realUserId && prev === null) {
      // Fresh sign-in: offer to merge guest chat into the account, then clear
      // the guest meter so the user is no longer rate-limited.
      void useChatStore.getState().migrateGuestConversations();
      useGuestStore.getState().reset();
      useAuthStore.getState().closeLoginModal();
    }
    prevUserId.current = realUserId;
  }, [user, loading]);

  const signInWithGoogle = React.useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }, []);

  const signOut = React.useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured,
      tier: user ? user.tier : "GUEST",
      signInWithGoogle,
      signOut,
    }),
    [user, loading, configured, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
